'use strict';

var mongoose = require('mongoose'),
    Settings = mongoose.model('Settings'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    rest = require('../others/restware');

/**
 * Calculate total spots available per day based on ad time window
 * Formula: (endTime - startTime in seconds) / 20
 */
exports.calculateDailySpots = function (settings) {
    if (!settings || !settings.adTimeWindow || !settings.adTimeWindow.enabled) {
        return 0;
    }

    var startTime = settings.adTimeWindow.startTime; // "HH:MM" format
    var endTime = settings.adTimeWindow.endTime;

    if (!startTime || !endTime) {
        return 0;
    }

    // Parse time strings to get hours and minutes
    var startParts = startTime.split(':');
    var endParts = endTime.split(':');

    var startSeconds = (parseInt(startParts[0]) * 3600) + (parseInt(startParts[1]) * 60);
    var endSeconds = (parseInt(endParts[0]) * 3600) + (parseInt(endParts[1]) * 60);

    // Handle case where end time is before start time (crosses midnight)
    if (endSeconds < startSeconds) {
        endSeconds += 24 * 3600; // Add 24 hours
    }

    var durationSeconds = endSeconds - startSeconds;
    var totalSpots = Math.floor(durationSeconds / 20);

    return totalSpots;
};

/**
 * Get remaining spots for each day in a date range
 * Returns object with date as key and remaining spots as value
 */
exports.getRemainingSpotsByDate = function (startDate, endDate, callback) {
    // Get settings to calculate daily spots
    Settings.findOne({}, function (err, settings) {
        if (err) return callback(err);

        var dailySpots = exports.calculateDailySpots(settings);

        if (dailySpots === 0) {
            return callback(new Error('Advertisement time window not configured'));
        }

        // Get all active purchases that overlap with the date range
        SpotPurchase.find({
            active: true,
            deploymentStatus: { $in: ['pending', 'deployed'] },
            startDate: { $lte: endDate },
            endDate: { $gte: startDate }
        }, function (err, purchases) {
            if (err) return callback(err);

            // Calculate remaining spots for each day
            var result = {};
            var currentDate = new Date(startDate);
            currentDate.setHours(0, 0, 0, 0);
            var end = new Date(endDate);
            end.setHours(0, 0, 0, 0);

            while (currentDate <= end) {
                var dateStr = currentDate.toISOString().split('T')[0];
                var usedSpots = 0;

                // Sum up spots from all purchases active on this date
                purchases.forEach(function (purchase) {
                    var purchaseStart = new Date(purchase.startDate);
                    purchaseStart.setHours(0, 0, 0, 0);
                    var purchaseEnd = new Date(purchase.endDate);
                    purchaseEnd.setHours(0, 0, 0, 0);

                    if (currentDate >= purchaseStart && currentDate <= purchaseEnd) {
                        usedSpots += purchase.spotsPerDay || 0;
                    }
                });

                result[dateStr] = Math.max(0, dailySpots - usedSpots);
                currentDate.setDate(currentDate.getDate() + 1);
            }

            callback(null, result);
        });
    });
};

/**
 * Validate if enough spots are available for a purchase
 */
exports.validatePurchaseAvailability = function (advertiserId, startDate, endDate, spotsPerDay, callback) {
    exports.getRemainingSpotsByDate(startDate, endDate, function (err, remainingByDate) {
        if (err) return callback(err);

        var unavailableDates = [];

        for (var dateStr in remainingByDate) {
            if (remainingByDate[dateStr] < spotsPerDay) {
                unavailableDates.push({
                    date: dateStr,
                    available: remainingByDate[dateStr],
                    needed: spotsPerDay
                });
            }
        }

        if (unavailableDates.length > 0) {
            return callback(null, {
                valid: false,
                unavailableDates: unavailableDates,
                message: 'Not enough available spots on one or more selected days. Please reduce quantity or select a different date range.'
            });
        }

        callback(null, { valid: true, message: 'Spots available for all selected days' });
    });
};

/**
 * API endpoint: Get daily spots calculation
 */
exports.getDailySpots = function (req, res) {
    Settings.findOne({}, function (err, settings) {
        if (err) return rest.sendError(res, 'Error loading settings', err);

        var dailySpots = exports.calculateDailySpots(settings);

        return rest.sendSuccess(res, 'Daily spots calculation', {
            enabled: settings && settings.adTimeWindow && settings.adTimeWindow.enabled,
            startTime: settings && settings.adTimeWindow ? settings.adTimeWindow.startTime : null,
            endTime: settings && settings.adTimeWindow ? settings.adTimeWindow.endTime : null,
            dailySpots: dailySpots
        });
    });
};

/**
 * API endpoint: Check availability for a date range
 */
exports.checkAvailability = function (req, res) {
    var startDate = req.body.startDate;
    var endDate = req.body.endDate;
    var spotsPerDay = req.body.spotsPerDay;

    if (!startDate || !endDate) {
        return rest.sendError(res, 'Start date and end date are required');
    }

    if (!spotsPerDay || spotsPerDay < 1) {
        return rest.sendError(res, 'Spots per day must be at least 1');
    }

    exports.validatePurchaseAvailability(null, new Date(startDate), new Date(endDate), spotsPerDay, function (err, result) {
        if (err) return rest.sendError(res, 'Error checking availability', err);

        return rest.sendSuccess(res, 'Availability check', result);
    });
};
