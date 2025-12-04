'use strict';

var mongoose = require('mongoose'),
    Advertiser = mongoose.model('Advertiser'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    Asset = mongoose.model('Asset'),
    rest = require('../others/restware'),
    spotAvailability = require('./spot-availability'),
    _ = require('lodash');

// Purchase spots for an advertiser
exports.purchaseSpots = function (req, res) {
    var purchaseData = req.body;

    // Validate required fields
    if (!purchaseData.advertiserId) {
        return rest.sendError(res, 'Advertiser ID is required');
    }

    if (!purchaseData.adAsset || !purchaseData.adAsset.filename) {
        return rest.sendError(res, 'Ad asset filename is required');
    }

    if (!purchaseData.sets || purchaseData.sets < 1) {
        return rest.sendError(res, 'Number of sets must be at least 1');
    }

    // Validate date range (NEW REQUIREMENT)
    if (!purchaseData.startDate || !purchaseData.endDate) {
        return rest.sendError(res, 'Campaign start date and end date are required');
    }

    var startDate = new Date(purchaseData.startDate);
    var endDate = new Date(purchaseData.endDate);

    if (startDate > endDate) {
        return rest.sendError(res, 'Start date must be before or equal to end date');
    }

    // Validate ad asset duration (must be 20 seconds)
    if (purchaseData.adAsset.duration && purchaseData.adAsset.duration !== 20) {
        return rest.sendError(res, 'Ad asset duration must be exactly 20 seconds for spot-based advertising');
    }

    // Set duration to 20 if not provided
    if (!purchaseData.adAsset.duration) {
        purchaseData.adAsset.duration = 20;
    }

    // Get advertiser details
    Advertiser.load(purchaseData.advertiserId, function (err, advertiser) {
        if (err || !advertiser) {
            return rest.sendError(res, 'Advertiser not found', err);
        }

        var totalSpots = purchaseData.sets * 40;
        var spotsPerDay = totalSpots; // Spots are per day, not divided
        var pricePerSet = purchaseData.pricePerSet || 0;

        // Validate spot availability for the date range
        spotAvailability.validatePurchaseAvailability(
            purchaseData.advertiserId,
            startDate,
            endDate,
            spotsPerDay,
            function (err, validation) {
                if (err) {
                    return rest.sendError(res, 'Error validating spot availability', err);
                }

                if (!validation.valid) {
                    return rest.sendError(res, validation.message, validation.unavailableDates);
                }

                // Create spot purchase
                var purchase = new SpotPurchase({
                    advertiser: {
                        _id: advertiser._id,
                        name: advertiser.name
                    },
                    adAsset: purchaseData.adAsset,
                    sets: purchaseData.sets,
                    totalSpots: totalSpots,
                    spotsRemaining: totalSpots,
                    spotsPerDay: spotsPerDay,
                    startDate: startDate,
                    endDate: endDate,
                    targetGroups: purchaseData.targetGroups || [],
                    pricePerSet: pricePerSet,
                    totalPrice: pricePerSet * purchaseData.sets,
                    deploymentStatus: 'pending',
                    expirationDate: purchaseData.expirationDate,
                    createdBy: purchaseData.createdBy
                });

                purchase.save(function (err, savedPurchase) {
                    if (err) {
                        return rest.sendError(res, 'Error creating spot purchase', err);
                    }

                    // Update advertiser's total spots
                    advertiser.totalSpotsPurchased = (advertiser.totalSpotsPurchased || 0) + savedPurchase.totalSpots;
                    advertiser.totalSpotsRemaining = (advertiser.totalSpotsRemaining || 0) + savedPurchase.spotsRemaining;

                    advertiser.save(function (err) {
                        if (err) {
                            console.log('Error updating advertiser spot counts:', err);
                        }

                        // Update asset if it exists
                        Asset.findOne({ name: purchaseData.adAsset.filename }, function (err, asset) {
                            if (!err && asset) {
                                asset.isAdvertisement = true;
                                asset.advertiser = {
                                    _id: advertiser._id,
                                    name: advertiser.name
                                };
                                asset.spotsPurchased = (asset.spotsPurchased || 0) + savedPurchase.totalSpots;
                                asset.spotsRemaining = (asset.spotsRemaining || 0) + savedPurchase.spotsRemaining;
                                asset.save(function (err) {
                                    if (err) console.log('Error updating asset:', err);
                                });
                            }
                        });

                        console.log('Spot purchase created with date range:', startDate, 'to', endDate);

                        recalculateAdvertiserSpotTotals(advertiser._id, function (totalsErr) {
                            if (totalsErr) {
                                console.log('Error recalculating advertiser totals:', totalsErr);
                            }
                        });

                        return rest.sendSuccess(res, 'Spot purchase created successfully', savedPurchase);
                    });
                });
            },
            null
        );
    });
};

// Get purchases for an advertiser
exports.getAdvertiserPurchases = function (req, res) {
    var advertiserId = req.params.advertiserId;

    if (!advertiserId) {
        return rest.sendError(res, 'Advertiser ID is required');
    }

    SpotPurchase.getByAdvertiser(advertiserId, function (err, purchases) {
        if (err)
            return rest.sendError(res, 'Error getting purchases', err);
        else
            return rest.sendSuccess(res, 'Advertiser purchases', purchases || []);
    });
};

// Get remaining spots for an advertiser
exports.getRemainingSpots = function (req, res) {
    var advertiserId = req.params.advertiserId;

    if (!advertiserId) {
        return rest.sendError(res, 'Advertiser ID is required');
    }

    Advertiser.load(advertiserId, function (err, advertiser) {
        if (err || !advertiser) {
            return rest.sendError(res, 'Advertiser not found', err);
        }

        SpotPurchase.getActivePurchases(advertiserId, function (err, purchases) {
            if (err) {
                return rest.sendError(res, 'Error getting active purchases', err);
            }

            var totalRemaining = purchases.reduce(function (sum, purchase) {
                return sum + purchase.spotsRemaining;
            }, 0);

            return rest.sendSuccess(res, 'Remaining spots', {
                advertiserId: advertiserId,
                advertiserName: advertiser.name,
                totalSpotsPurchased: advertiser.totalSpotsPurchased,
                totalSpotsRemaining: totalRemaining,
                activePurchases: purchases.length
            });
        });
    });
};

// List all spot purchases
exports.index = function (req, res) {
    var criteria = {};

    if (req.query['advertiserId']) {
        criteria['advertiser._id'] = req.query['advertiserId'];
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

    SpotPurchase.list(options, function (err, purchases) {
        if (err)
            return rest.sendError(res, 'Unable to get spot purchase list', err);
        else
            return rest.sendSuccess(res, 'Sending spot purchase list', purchases || []);
    });
};

// Get purchases by deployment status
exports.getPurchasesByDeploymentStatus = function (req, res) {
    var status = req.params.status;

    if (!status || !['pending', 'deployed', 'error'].includes(status)) {
        return rest.sendError(res, 'Invalid deployment status. Must be: pending, deployed, or error');
    }

    SpotPurchase.find({ deploymentStatus: status })
        .populate('advertiser._id')
        .populate('targetGroups')
        .sort({ purchaseDate: -1 })
        .exec(function (err, purchases) {
            if (err)
                return rest.sendError(res, 'Error getting purchases by status', err);
            else
                return rest.sendSuccess(res, 'Purchases with status: ' + status, purchases || []);
        });
};

// Get a single purchase by id
exports.getPurchaseById = function (req, res) {
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

            return rest.sendSuccess(res, 'Spot purchase details', purchase);
        });
};

// Update a pending purchase
exports.updatePurchase = function (req, res) {
    var purchaseId = req.params.purchaseId;
    var updatedData = req.body || {};

    if (!purchaseId) {
        return rest.sendError(res, 'Purchase ID is required');
    }

    SpotPurchase.findById(purchaseId)
        .populate('advertiser._id')
        .exec(function (err, purchase) {
            if (err || !purchase) {
                return rest.sendError(res, 'Purchase not found', err);
            }

            if (purchase.deploymentStatus !== 'pending') {
                return rest.sendError(res, 'Only pending purchases can be edited');
            }

            if (!updatedData.adAsset || !updatedData.adAsset.filename) {
                return rest.sendError(res, 'Ad asset filename is required');
            }

            if (updatedData.adAsset.duration && updatedData.adAsset.duration !== 20) {
                return rest.sendError(res, 'Ad asset duration must be exactly 20 seconds for spot-based advertising');
            }

            if (!updatedData.adAsset.duration) {
                updatedData.adAsset.duration = 20;
            }

            if (!updatedData.sets || updatedData.sets < 1) {
                return rest.sendError(res, 'Number of sets must be at least 1');
            }

            if (!updatedData.startDate || !updatedData.endDate) {
                return rest.sendError(res, 'Campaign start date and end date are required');
            }

            if (!updatedData.targetGroups || updatedData.targetGroups.length === 0) {
                return rest.sendError(res, 'Please select at least one target group');
            }

            var startDate = new Date(updatedData.startDate);
            var endDate = new Date(updatedData.endDate);

            if (startDate > endDate) {
                return rest.sendError(res, 'Start date must be before or equal to end date');
            }

            var sets = updatedData.sets;
            var totalSpots = sets * 40;
            var spotsPerDay = totalSpots;
            var pricePerSet = updatedData.pricePerSet || 0;

            spotAvailability.validatePurchaseAvailability(
                purchase.advertiser._id,
                startDate,
                endDate,
                spotsPerDay,
                function (validationErr, validation) {
                    if (validationErr) {
                        return rest.sendError(res, 'Error validating spot availability', validationErr);
                    }

                    if (!validation.valid) {
                        return rest.sendError(res, validation.message, validation.unavailableDates);
                    }

                    purchase.adAsset = updatedData.adAsset;
                    purchase.sets = sets;
                    purchase.totalSpots = totalSpots;
                    purchase.spotsPerDay = spotsPerDay;
                    purchase.spotsRemaining = totalSpots;
                    purchase.startDate = startDate;
                    purchase.endDate = endDate;
                    purchase.targetGroups = updatedData.targetGroups;
                    purchase.weekdays = updatedData.weekdays || purchase.weekdays;
                    purchase.pricePerSet = pricePerSet;
                    purchase.totalPrice = pricePerSet * sets;
                    purchase.expirationDate = updatedData.expirationDate;

                    purchase.save(function (saveErr, savedPurchase) {
                        if (saveErr) {
                            return rest.sendError(res, 'Error updating purchase', saveErr);
                        }

                        recalculateAdvertiserSpotTotals(purchase.advertiser._id, function (recalcErr) {
                            if (recalcErr) {
                                console.log('Error recalculating advertiser totals:', recalcErr);
                            }

                            return rest.sendSuccess(res, 'Purchase updated successfully', savedPurchase);
                        });
                    });
                },
                { excludePurchaseId: purchase._id.toString() }
            );
        });
};

// Decrement spots (called internally after playlist generation)
exports.decrementSpots = function (purchaseId, spotsUsed, callback) {
    SpotPurchase.decrementSpots(purchaseId, spotsUsed, function (err, purchase) {
        if (err) {
            console.log('Error decrementing spots:', err);
            return callback(err);
        }

        // Update advertiser's remaining spots
        Advertiser.load(purchase.advertiser._id, function (err, advertiser) {
            if (!err && advertiser) {
                advertiser.totalSpotsRemaining = Math.max(0, advertiser.totalSpotsRemaining - spotsUsed);
                advertiser.save(function (err) {
                    if (err) console.log('Error updating advertiser remaining spots:', err);
                });
            }
        });

        // Update asset's remaining spots
        Asset.findOne({ name: purchase.adAsset.filename }, function (err, asset) {
            if (!err && asset && asset.isAdvertisement) {
                asset.spotsRemaining = Math.max(0, asset.spotsRemaining - spotsUsed);
                asset.save(function (err) {
                    if (err) console.log('Error updating asset remaining spots:', err);
                });
            }
        });

        callback(null, purchase);
    });
};

function recalculateAdvertiserSpotTotals(advertiserId, callback) {
    if (!advertiserId) {
        return callback ? callback(new Error('Advertiser ID is required')) : null;
    }

    var advObjectId;
    try {
        advObjectId = typeof advertiserId === 'string' ? mongoose.Types.ObjectId(advertiserId) : advertiserId;
    } catch (e) {
        return callback ? callback(e) : null;
    }

    SpotPurchase.find({ 'advertiser._id': advObjectId, active: true }, 'totalSpots spotsRemaining', function (err, purchases) {
        if (err) {
            return callback ? callback(err) : null;
        }

        var totals = purchases.reduce(function (acc, purchase) {
            acc.purchased += purchase.totalSpots || 0;
            acc.remaining += purchase.spotsRemaining || 0;
            return acc;
        }, { purchased: 0, remaining: 0 });

        Advertiser.findById(advObjectId, function (advErr, advertiser) {
            if (advErr || !advertiser) {
                return callback ? callback(advErr || new Error('Advertiser not found')) : null;
            }

            advertiser.totalSpotsPurchased = totals.purchased;
            advertiser.totalSpotsRemaining = totals.remaining;

            advertiser.save(function (saveErr) {
                if (callback) callback(saveErr);
            });
        });
    });
}

