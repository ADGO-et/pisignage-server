'use strict';

var mongoose = require('mongoose'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    Advertiser = mongoose.model('Advertiser'),
    Group = mongoose.model('Group'),
    // Playlist model will be accessed via mongoose.model('Playlist') inside functions
    Settings = mongoose.model('Settings'),
    rest = require('../others/restware'),
    _ = require('lodash');

/**
 * Deploy all pending purchases
 * Creates daily playlists for each date with active campaigns
 */
exports.deployAllPurchases = function (req, res) {
    // Get all purchases regardless of current deployment status (pending/success/error)
    var statusesToProcess = ['pending', 'deployed', 'error'];

    SpotPurchase.find({ deploymentStatus: { $in: statusesToProcess }, active: true })
        .populate('advertiser._id')
        .populate('targetGroups')
        .exec(function (err, purchases) {
            if (err) {
                return rest.sendError(res, 'Error loading pending purchases', err);
            }

            if (!purchases || purchases.length === 0) {
                return rest.sendSuccess(res, 'No pending purchases to deploy', {
                    deployed: 0,
                    errors: 0,
                    details: []
                });
            }

            // Get settings for ad time window
            Settings.findOne({}, function (err, settings) {
                if (err) {
                    return rest.sendError(res, 'Error loading settings', err);
                }

                if (!settings || !settings.adTimeWindow || !settings.adTimeWindow.enabled) {
                    return rest.sendError(res, 'Advertisement time window is not configured. Please configure it in Settings first.');
                }

                var deploymentResults = {
                    deployed: 0,
                    errors: 0,
                    details: []
                };

                var processedCount = 0;

                // Process each purchase
                purchases.forEach(function (purchase) {
                    deployPurchase(purchase, settings, function (err, result) {
                        processedCount++;

                        if (err) {
                            deploymentResults.errors++;
                            deploymentResults.details.push({
                                purchaseId: purchase._id,
                                advertiser: purchase.advertiser.name,
                                status: 'error',
                                error: err.message || err
                            });

                            // Update purchase status to error
                            purchase.deploymentStatus = 'error';
                            purchase.deploymentError = err.message || err.toString();
                            purchase.save();
                        } else {
                            deploymentResults.deployed++;
                            deploymentResults.details.push({
                                purchaseId: purchase._id,
                                advertiser: purchase.advertiser.name,
                                status: 'deployed',
                                groups: result.groups,
                                datesDeployed: result.dates
                            });

                            // Update purchase status to deployed
                            purchase.deploymentStatus = 'deployed';
                            purchase.deployedAt = new Date();
                            purchase.deploymentError = null;
                            purchase.save();
                        }

                        // When all purchases are processed, send response
                        if (processedCount === purchases.length) {
                            return rest.sendSuccess(res, 'Deployment completed', deploymentResults);
                        }
                    });
                });
            });
        });
};

/**
 * Deploy a single purchase
 * Creates playlists for each day in the campaign date range
 */
function deployPurchase(purchase, settings, callback) {
    // Validate advertiser is still active
    if (!purchase.advertiser || !purchase.advertiser._id) {
        return callback(new Error('Advertiser not found'));
    }

    Advertiser.findById(purchase.advertiser._id, function (err, advertiser) {
        if (err || !advertiser) {
            return callback(new Error('Advertiser not found'));
        }

        if (!advertiser.active) {
            return callback(new Error('Advertiser is not active'));
        }

        // Validate target groups
        if (!purchase.targetGroups || purchase.targetGroups.length === 0) {
            return callback(new Error('No target groups specified for this purchase'));
        }

        // Generate playlists for each day in the date range
        var startDate = new Date(purchase.startDate);
        startDate.setHours(0, 0, 0, 0);
        var endDate = new Date(purchase.endDate);
        endDate.setHours(0, 0, 0, 0);

        var deployedDates = [];
        var deployedGroups = [];

        // For each target group
        purchase.targetGroups.forEach(function (groupId) {
            Group.findById(groupId, function (err, group) {
                if (err || !group) {
                    console.log('Error loading group:', groupId, err);
                    return;
                }

                deployedGroups.push(group.name);

                // For each day in the date range
                var currentDate = new Date(startDate);
                while (currentDate <= endDate) {
                    var dateStr = currentDate.toISOString().split('T')[0];

                    // Create or update ad playlist for this date and group
                    createDailyAdPlaylist(group, currentDate, settings, function (err, playlist) {
                        if (err) {
                            console.log('Error creating playlist for', dateStr, err);
                        } else {
                            deployedDates.push(dateStr);
                        }
                    });

                    currentDate.setDate(currentDate.getDate() + 1);
                }
            });
        });

        // Return success (async operations continue in background)
        setTimeout(function () {
            callback(null, {
                groups: _.uniq(deployedGroups),
                dates: _.uniq(deployedDates)
            });
        }, 500);
    });
}

/**
 * Create or update daily ad playlist for a specific date and group
 */
function createDailyAdPlaylist(group, date, settings, callback) {
    var dateStr = date.toISOString().split('T')[0];

    // Get Playlist model dynamically to avoid loading order issues
    var Playlist = mongoose.model('Playlist');

    // Get all deployed purchases active on this date for this group
    SpotPurchase.find({
        deploymentStatus: 'deployed',
        active: true,
        startDate: { $lte: date },
        endDate: { $gte: date },
        targetGroups: group._id
    }).exec(function (err, purchases) {
        if (err) return callback(err);

        if (!purchases || purchases.length === 0) {
            return callback(null, null); // No ads for this date
        }

        // Build playlist assets
        var playlistAssets = [];

        purchases.forEach(function (purchase) {
            // Add spots for this purchase (spotsPerDay times)
            for (var i = 0; i < purchase.spotsPerDay; i++) {
                playlistAssets.push({
                    filename: purchase.adAsset.filename,
                    duration: 20,
                    advertiser: purchase.advertiser.name
                });
            }
        });

        // Shuffle for even distribution
        playlistAssets = _.shuffle(playlistAssets);

        // Create playlist name
        var playlistName = 'Ads_' + group.name + '_' + dateStr;

        // Find or create playlist
        Playlist.findOne({ name: playlistName }, function (err, playlist) {
            if (err) return callback(err);

            if (!playlist) {
                playlist = new Playlist({
                    name: playlistName,
                    assets: playlistAssets.map(function (a) { return a.filename; }),
                    settings: {
                        durationEnable: true,
                        startdate: date,
                        enddate: date,
                        timeEnable: true,
                        starttime: settings.adTimeWindow.startTime,
                        endtime: settings.adTimeWindow.endTime
                    }
                });
            } else {
                // Update existing playlist
                playlist.assets = playlistAssets.map(function (a) { return a.filename; });
                playlist.settings.startdate = date;
                playlist.settings.enddate = date;
                playlist.settings.starttime = settings.adTimeWindow.startTime;
                playlist.settings.endtime = settings.adTimeWindow.endTime;
            }

            playlist.save(function (err, savedPlaylist) {
                if (err) return callback(err);

                // Add playlist to group if not already there
                if (!group.playlists.find(function (p) { return p.name === playlistName; })) {
                    group.playlists.push({
                        name: playlistName,
                        settings: savedPlaylist.settings
                    });
                    group.save();
                }

                callback(null, savedPlaylist);
            });
        });
    });
}

/**
 * Redeploy a single purchase by ID
 */
exports.redeployPurchase = function (req, res) {
    var purchaseId = req.params.purchaseId;

    if (!purchaseId) {
        return rest.sendError(res, 'Purchase ID is required');
    }

    SpotPurchase.findById(purchaseId)
        .populate('advertiser._id')
        .populate('targetGroups')
        .exec(function (err, purchase) {
            if (err || !purchase) {
                return rest.sendError(res, 'Purchase not found', err);
            }

            Settings.findOne({}, function (err, settings) {
                if (err) {
                    return rest.sendError(res, 'Error loading settings', err);
                }

                if (!settings || !settings.adTimeWindow || !settings.adTimeWindow.enabled) {
                    return rest.sendError(res, 'Advertisement time window is not configured');
                }

                deployPurchase(purchase, settings, function (err, result) {
                    if (err) {
                        purchase.deploymentStatus = 'error';
                        purchase.deploymentError = err.message || err.toString();
                        purchase.save();

                        return rest.sendError(res, 'Error redeploying purchase', err);
                    }

                    purchase.deploymentStatus = 'deployed';
                    purchase.deployedAt = new Date();
                    purchase.deploymentError = null;
                    purchase.save();

                    return rest.sendSuccess(res, 'Purchase redeployed successfully', {
                        purchaseId: purchase._id,
                        advertiser: purchase.advertiser.name,
                        groups: result.groups,
                        datesDeployed: result.dates
                    });
                });
            });
        });
};
