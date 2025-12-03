'use strict';

var mongoose = require('mongoose'),
    Advertiser = mongoose.model('Advertiser'),
    SpotPurchase = mongoose.model('SpotPurchase'),
    Group = mongoose.model('Group'),
    fs = require('fs'),
    path = require('path'),
    config = require('../../config/config'),
    async = require('async'),
    serverMain = require('./server-main');

var spotPurchases = require('./spot-purchases');

/**
 * Generate ad schedule for a group based on active advertisers and their spot purchases
 * This is the main entry point for playlist generation
 */
exports.generateAdSchedule = function (groupId, callback) {
    var group, advertisers, defaultPlaylist;

    async.series([
        // Step 1: Load the group
        function (cb) {
            Group.load(groupId, function (err, grp) {
                if (err || !grp) return cb(err || 'Group not found');
                group = grp;
                cb();
            });
        },

        // Step 2: Get active advertisers for current time
        function (cb) {
            var currentDate = new Date();
            Advertiser.getActiveAdvertisers(currentDate, function (err, advs) {
                if (err) return cb(err);
                advertisers = advs || [];
                console.log('Found ' + advertisers.length + ' active advertisers');
                cb();
            });
        },

        // Step 3: Load default playlist
        function (cb) {
            var defaultPlaylistPath = path.join(config.mediaDir, '__' + (config.defaultPlaylist || 'default') + '.json');
            fs.readFile(defaultPlaylistPath, 'utf8', function (err, data) {
                if (!err && data) {
                    try {
                        defaultPlaylist = JSON.parse(data);
                    } catch (e) {
                        console.log('Error parsing default playlist:', e);
                    }
                }
                if (!defaultPlaylist) {
                    defaultPlaylist = { name: 'default', assets: [] };
                }
                cb(); // Don't fail if default playlist doesn't exist
            });
        },

        // Step 4: Generate playlists
        function (cb) {
            if (advertisers.length === 0) {
                console.log('No active advertisers, skipping ad playlist generation');
                return cb();
            }

            generatePlaylistsForAdvertisers(group, advertisers, defaultPlaylist, cb);
        }

    ], function (err) {
        if (err) {
            console.log('Error generating ad schedule:', err);
            return callback(err);
        }

        console.log('Ad schedule generated successfully for group:', group.name);
        callback(null, group);
    });
};

/**
 * Generate playlists for all advertisers
 */
function generatePlaylistsForAdvertisers(group, advertisers, defaultPlaylist, callback) {
    var allPurchases = [];

    // Collect all active spot purchases for all advertisers
    async.each(advertisers, function (advertiser, cb) {
        SpotPurchase.getActivePurchases(advertiser._id, function (err, purchases) {
            if (!err && purchases) {
                allPurchases = allPurchases.concat(purchases.map(function (p) {
                    return {
                        advertiser: advertiser,
                        purchase: p
                    };
                }));
            }
            cb();
        });
    }, function (err) {
        if (err) return callback(err);

        if (allPurchases.length === 0) {
            console.log('No active spot purchases found');
            return callback();
        }

        // Build weighted queue and generate playlists
        buildAndDeployPlaylists(group, allPurchases, defaultPlaylist, callback);
    });
}

/**
 * Build weighted queue and create playlist files
 */
function buildAndDeployPlaylists(group, allPurchases, defaultPlaylist, callback) {
    // Calculate total spots across all purchases
    var totalAdSpots = allPurchases.reduce(function (sum, item) {
        return sum + item.purchase.spotsRemaining;
    }, 0);

    console.log('Total ad spots to distribute:', totalAdSpots);

    // Build weighted queue (fair distribution)
    var queue = buildWeightedQueue(allPurchases, defaultPlaylist);

    // Create a single combined playlist with the weighted queue
    var combinedPlaylist = createCombinedPlaylist(group, queue);

    // Save the playlist file
    var playlistPath = path.join(config.mediaDir, '__ad_schedule_' + group.name + '.json');
    fs.writeFile(playlistPath, JSON.stringify(combinedPlaylist, null, 4), function (err) {
        if (err) {
            console.log('Error saving ad schedule playlist:', err);
            return callback(err);
        }

        console.log('Ad schedule playlist saved:', playlistPath);

        // Add this playlist to the group's playlists
        addAdPlaylistToGroup(group, combinedPlaylist.name, callback);
    });
}

/**
 * Build a weighted queue for fair distribution
 * Example: If Pepsi has 80 spots and Coke has 40, queue will be:
 * [Pepsi, Pepsi, Coke, Default, Default, ...]
 */
function buildWeightedQueue(allPurchases, defaultPlaylist) {
    var queue = [];

    // Calculate total spots
    var totalSpots = allPurchases.reduce(function (sum, item) {
        return sum + item.purchase.spotsRemaining;
    }, 0);

    // Calculate GCD for fair distribution
    var gcd = function (a, b) {
        return b === 0 ? a : gcd(b, a % b);
    };

    // Find GCD of all spot counts
    var divisor = allPurchases.reduce(function (g, item) {
        return gcd(g, item.purchase.spotsRemaining);
    }, allPurchases[0].purchase.spotsRemaining);

    // Build queue with proportional distribution
    allPurchases.forEach(function (item) {
        var count = Math.floor(item.purchase.spotsRemaining / divisor);
        for (var i = 0; i < count; i++) {
            queue.push({
                type: 'ad',
                filename: item.purchase.adAsset.filename,
                duration: 20,
                advertiser: item.advertiser.name,
                purchaseId: item.purchase._id
            });
        }
    });

    // Add default playlist assets to fill gaps
    // Add default assets in proportion (e.g., 1 default for every 1 ad to ensure gaps)
    var defaultAssets = defaultPlaylist.assets || [];
    if (defaultAssets.length > 0) {
        var defaultCount = Math.max(1, queue.length); // 1:1 ratio minimum
        for (var i = 0; i < defaultCount; i++) {
            var asset = defaultAssets[i % defaultAssets.length];
            queue.push({
                type: 'default',
                filename: asset.filename,
                duration: asset.duration || 20
            });
        }
    }

    // Shuffle the queue for even distribution
    queue = fairShuffle(queue);

    // Ensure minimum playlist duration (e.g., 5 minutes) to prevent frequent looping
    // This addresses the user's concern about "filling the gap"
    var totalDuration = queue.reduce(function (sum, item) { return sum + (item.duration || 20); }, 0);
    var minDuration = 300; // 5 minutes in seconds

    if (totalDuration > 0 && totalDuration < minDuration) {
        var multiplier = Math.ceil(minDuration / totalDuration);
        var originalQueue = queue.slice();
        for (var k = 1; k < multiplier; k++) {
            queue = queue.concat(originalQueue);
        }
        console.log('Extended playlist duration from ' + totalDuration + 's to ' + (totalDuration * multiplier) + 's');
    }

    return queue;
}

/**
 * Fair shuffle algorithm to ensure even distribution
 * Prevents same ad from appearing consecutively
 */
function fairShuffle(queue) {
    var shuffled = [];
    var remaining = queue.slice(); // Copy array

    // Group by advertiser
    var byAdvertiser = {};
    remaining.forEach(function (item) {
        var key = item.type === 'ad' ? item.advertiser : 'default';
        if (!byAdvertiser[key]) byAdvertiser[key] = [];
        byAdvertiser[key].push(item);
    });

    var advertisers = Object.keys(byAdvertiser);
    var index = 0;

    // Round-robin distribution
    while (remaining.length > 0) {
        var advertiser = advertisers[index % advertisers.length];

        if (byAdvertiser[advertiser] && byAdvertiser[advertiser].length > 0) {
            shuffled.push(byAdvertiser[advertiser].shift());
        }

        // Remove empty advertisers
        if (!byAdvertiser[advertiser] || byAdvertiser[advertiser].length === 0) {
            advertisers.splice(advertisers.indexOf(advertiser), 1);
        }

        index++;
        remaining = remaining.filter(function (item) {
            var key = item.type === 'ad' ? item.advertiser : 'default';
            return byAdvertiser[key] && byAdvertiser[key].length > 0;
        });
    }

    return shuffled;
}

/**
 * Create a combined playlist with all ads and defaults
 */
function createCombinedPlaylist(group, queue) {
    var playlist = {
        name: 'ad_schedule_' + group.name,
        settings: {
            ticker: { enable: false },
            ads: { adPlaylist: false },
            audio: { enable: false }
        },
        assets: queue.map(function (item) {
            return {
                filename: item.filename,
                duration: item.duration
            };
        }),
        layout: '1',
        templateName: 'custom_layout.html',
        schedule: {}
    };

    return playlist;
}

/**
 * Add the ad playlist to the group's playlists
 */
function addAdPlaylistToGroup(group, playlistName, callback) {
    // Check if ad playlist already exists in group
    var existingIndex = -1;
    for (var i = 0; i < group.playlists.length; i++) {
        if (group.playlists[i].name === playlistName) {
            existingIndex = i;
            break;
        }
    }

    // Create playlist entry with schedule covering all advertiser time ranges
    var playlistEntry = {
        name: playlistName,
        settings: {
            durationEnable: false,
            timeEnable: true,
            weekdays: [1, 2, 3, 4, 5, 6, 7], // All days
            starttime: '00:00',
            endtime: '23:59'
        }
    };

    if (existingIndex >= 0) {
        // Update existing
        group.playlists[existingIndex] = playlistEntry;
    } else {
        // Add new (insert at position 1, after default playlist)
        group.playlists.splice(1, 0, playlistEntry);
    }

    // Save group
    group.save(function (err) {
        if (err) {
            console.log('Error saving group with ad playlist:', err);
            return callback(err);
        }

        console.log('Ad playlist added to group');
        callback();
    });
}

/**
 * Regenerate playlists for a specific group (API endpoint)
 */
exports.regenerateForGroup = function (req, res) {
    var groupId = req.params.groupId;

    if (!groupId) {
        return res.status(400).json({ success: false, message: 'Group ID is required' });
    }

    exports.generateAdSchedule(groupId, function (err, group) {
        if (err) {
            return res.status(500).json({ success: false, message: 'Error generating ad schedule', error: err });
        }

        // NOTE: Auto-deployment disabled per user request.
        // User must manually deploy the group to push changes to players.
        res.json({ success: true, message: 'Ad schedule generated successfully. Please deploy the group to apply changes.', data: group });
    });
};
