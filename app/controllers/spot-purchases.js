'use strict';

var mongoose = require('mongoose'),
    Advertiser = mongoose.model('Advertiser'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    Asset = mongoose.model('Asset'),
    rest = require('../others/restware'),
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

        // Create spot purchase
        var purchase = new SpotPurchase({
            advertiser: {
                _id: advertiser._id,
                name: advertiser.name
            },
            adAsset: purchaseData.adAsset,
            sets: purchaseData.sets,
            pricePerSet: purchaseData.pricePerSet || 0,
            expirationDate: purchaseData.expirationDate,
            createdBy: purchaseData.createdBy
        });

        purchase.save(function (err, savedPurchase) {
            if (err) {
                return rest.sendError(res, 'Error creating spot purchase', err);
            }

            // Update advertiser's total spots
            advertiser.totalSpotsPurchased += savedPurchase.totalSpots;
            advertiser.totalSpotsRemaining += savedPurchase.spotsRemaining;

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

                console.log('Spot purchase created');

                return rest.sendSuccess(res, 'Spot purchase created successfully', savedPurchase);
            });
        });
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
