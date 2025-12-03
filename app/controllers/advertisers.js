'use strict';

var mongoose = require('mongoose'),
    Advertiser = mongoose.model('Advertiser'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    rest = require('../others/restware'),
    _ = require('lodash');

// Load an advertiser object
exports.loadObject = function (req, res, next, id) {
    Advertiser.load(id, function (err, object) {
        if (err || !object)
            return rest.sendError(res, 'Unable to get advertiser details', err);

        req.advertiser = object;
        next();
    });
};

// List all advertisers
exports.index = function (req, res) {
    var criteria = {};

    if (req.query['string']) {
        var str = new RegExp(req.query['string'], "i");
        criteria['name'] = str;
    }

    if (req.query['active'] !== undefined) {
        criteria['active'] = req.query['active'] === 'true';
    }

    var page = req.query['page'] > 0 ? req.query['page'] : 0;
    var perPage = req.query['per_page'] || 100;

    var options = {
        perPage: perPage,
        page: page,
        criteria: criteria
    };

    Advertiser.list(options, function (err, advertisers) {
        if (err)
            return rest.sendError(res, 'Unable to get advertiser list', err);
        else
            return rest.sendSuccess(res, 'Sending advertiser list', advertisers || []);
    });
};

// Get single advertiser
exports.getObject = function (req, res) {
    var advertiser = req.advertiser;
    if (advertiser) {
        // Also get spot purchases for this advertiser
        SpotPurchase.getByAdvertiser(advertiser._id, function (err, purchases) {
            var response = advertiser.toObject();
            response.purchases = purchases || [];
            return rest.sendSuccess(res, 'Advertiser details', response);
        });
    } else {
        return rest.sendError(res, 'Unable to retrieve advertiser details');
    }
};

// Create new advertiser
exports.createObject = function (req, res) {
    var advertiserData = req.body;

    // Validate required fields
    if (!advertiserData.name) {
        return rest.sendError(res, 'Advertiser name is required');
    }

    if (!advertiserData.validTimeRange ||
        !advertiserData.validTimeRange.startDate ||
        !advertiserData.validTimeRange.endDate) {
        return rest.sendError(res, 'Valid time range with start and end dates is required');
    }

    // Validate time range
    var validation = validateTimeRange(advertiserData.validTimeRange);
    if (!validation.valid) {
        return rest.sendError(res, validation.error);
    }

    var advertiser = new Advertiser(advertiserData);

    advertiser.save(function (err, data) {
        if (err)
            return rest.sendError(res, 'Error creating advertiser', err);
        else
            return rest.sendSuccess(res, 'Advertiser created successfully', data);
    });
};

// Update advertiser
exports.updateObject = function (req, res) {
    var advertiser = req.advertiser;
    delete req.body.__v; // Don't copy version key

    // Validate time range if it's being updated
    if (req.body.validTimeRange) {
        var validation = validateTimeRange(req.body.validTimeRange);
        if (!validation.valid) {
            return rest.sendError(res, validation.error);
        }
    }

    advertiser = _.extend(advertiser, req.body);

    advertiser.save(function (err, data) {
        if (err)
            return rest.sendError(res, 'Error updating advertiser', err);
        else {
            // If time range was updated, trigger playlist regeneration
            if (req.body.validTimeRange) {
                // TODO: Trigger playlist regeneration
                console.log('Advertiser time range updated, should trigger playlist regeneration');
            }
            return rest.sendSuccess(res, 'Advertiser updated successfully', data);
        }
    });
};

// Delete advertiser
exports.deleteObject = function (req, res) {
    if (!req.advertiser)
        return rest.sendError(res, 'No advertiser specified');

    var advertiser = req.advertiser;

    // Check if advertiser has active spot purchases
    SpotPurchase.getActivePurchases(advertiser._id, function (err, purchases) {
        if (err)
            return rest.sendError(res, 'Error checking advertiser purchases', err);

        if (purchases && purchases.length > 0) {
            return rest.sendError(res, 'Cannot delete advertiser with active spot purchases. Please deactivate or complete all purchases first.');
        }

        advertiser.remove(function (err) {
            if (err)
                return rest.sendError(res, 'Unable to remove advertiser', err);
            else
                return rest.sendSuccess(res, 'Advertiser deleted successfully');
        });
    });
};

// Get active advertisers for current time
exports.getActiveAdvertisers = function (req, res) {
    var currentDate = req.query.date ? new Date(req.query.date) : new Date();

    Advertiser.getActiveAdvertisers(currentDate, function (err, advertisers) {
        if (err)
            return rest.sendError(res, 'Error getting active advertisers', err);
        else
            return rest.sendSuccess(res, 'Active advertisers', advertisers || []);
    });
};

// Validate time range
function validateTimeRange(timeRange) {
    if (!timeRange) {
        return { valid: false, error: 'Time range is required' };
    }

    // Validate dates
    var startDate = new Date(timeRange.startDate);
    var endDate = new Date(timeRange.endDate);

    if (isNaN(startDate.getTime())) {
        return { valid: false, error: 'Invalid start date' };
    }

    if (isNaN(endDate.getTime())) {
        return { valid: false, error: 'Invalid end date' };
    }

    if (startDate > endDate) {
        return { valid: false, error: 'Start date must be before or equal to end date' };
    }

    // Validate weekdays
    if (timeRange.weekdays) {
        if (!Array.isArray(timeRange.weekdays) || timeRange.weekdays.length === 0) {
            return { valid: false, error: 'At least one weekday must be selected' };
        }

        var invalidDay = timeRange.weekdays.find(d => d < 1 || d > 7);
        if (invalidDay !== undefined) {
            return { valid: false, error: 'Weekdays must be between 1 (Monday) and 7 (Sunday)' };
        }
    }

    return { valid: true };
}

exports.validateTimeRange = validateTimeRange;
