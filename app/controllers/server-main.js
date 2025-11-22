"use strict";

var mongoose = require("mongoose"),
  Player = mongoose.model("Player"),
  Asset = mongoose.model("Asset"),
  rest = require("../others/restware"),
  config = require("../../config/config"),
  fs = require("fs"),
  async = require("async"),
  util = require("util"),
  path = require("path");

var oldSocketio = require("./server-socket"),
  newSocketio = require("./server-socket-new"),
  webSocket = require("./server-socket-ws");

var playersToBeSynced = {},
  players = {};

exports.getStatus = function (req, res) {
  return rest.sendSuccess(res, "Dummy status", { server: true });
};

exports.getSettings = function () {};

exports.saveSettings = function () {};

exports.deploy = function (installation, group, cb) {
  var effectiveAssets; // New variable for non-banned assets

  async.series(
    [
      function (async_cb) {
        if (!group.playlists || group.playlists.length == 0)
          return async_cb("No Playlists assigned to the Group");

        Player.find({ "group._id": group._id }, function (err, data) {
          if (err || !data || data.length == 0) {
            console.log("Unable to get Players list for deploy,", err);
            async_cb("No Players associated, " + (err ? err : ""));
          } else {
            data.forEach(function (player) {
              playersToBeSynced[player.cpuSerialNumber] = player;
            });
            players[group._id.toString()] = data;
            async_cb();
          }
        });
      },
      // Filter out banned assets to compute effectiveAssets
      function (async_cb) {
        Asset.find(
          { name: { $in: group.assets }, banned: false },
          "name",
          function (err, allowed) {
            if (err) {
              console.log("Error filtering banned assets: ", err);
              return async_cb(err);
            }
            effectiveAssets = allowed.map(function (asset) {
              return asset.name;
            });
            async_cb();
          }
        );
      },
      // Fallback to default playlist if no valid assets remain
      function (async_cb) {
        if (
          effectiveAssets.length > 0 ||
          !group.playlists ||
          group.playlists.length === 0
        ) {
          return async_cb(); // Normal case or no playlists → proceed
        }

        console.log(
          `Group "${group.name}" has no valid (non-banned) assets → falling back to 'default' playlist`
        );

        // Switch to default playlist
        group.playlists = ["default"];
        group.deployedPlaylists = ["default"];

        // Rebuild effectiveAssets from default playlist
        Asset.find(
          { playlists: "default", banned: false },
          "name",
          function (err, defaultAssets) {
            if (!err && defaultAssets && defaultAssets.length > 0) {
              effectiveAssets = defaultAssets.map((a) => a.name);
              console.log(
                `Loaded ${effectiveAssets.length} assets from default playlist`
              );
            } else {
              effectiveAssets = [];
              console.log(
                "Warning: Default playlist is empty or has only banned assets"
              );
            }
            async_cb();
          }
        );
      },

      function (async_cb) {
        var syncPath = path.join(config.syncDir, installation, group.name),
          mediaPath = path.join(config.mediaDir);
        fs.mkdir(syncPath, function (err) {
          //console.log("created directory: "+syncPath)
          var filesNotPresent = [];
          async.eachSeries(
            effectiveAssets, // Use effectiveAssets instead of group.assets
            function (file, iterative_cb) {
              if (!file) return iterative_cb();

              var srcfile = path.join(mediaPath, file),
                dstfile = path.join(syncPath, file);
              fs.unlink(dstfile, function (err) {
                fs.stat(srcfile, function (err, stats) {
                  if (err || !stats.isFile()) {
                    if (file.indexOf("TV_OFF") == -1) {
                      //console.log("removing file as it is not present: " + file)
                      //group.assets.splice(group.assets.indexOf(file), 1)       //careful, async gets affected if the array is same
                      filesNotPresent.push(file);
                    }
                    iterative_cb();
                    //} else if (file.match(/^__.*\.json$/)) {     //uncomment this line and comment next line for symlinks
                  } else if (true) {
                    //copy the playlist files instead of symlink
                    var cbCalled = false,
                      done = function (err) {
                        if (!cbCalled) {
                          if (err) {
                            console.log(err);
                            var errMessage =
                              "Unable to copy playlist " +
                              file +
                              " for " +
                              installation;
                            util.log(errMessage);
                            iterative_cb(errMessage);
                          } else iterative_cb();
                          cbCalled = true;
                        }
                      };

                    var rd = fs.createReadStream(srcfile);
                    rd.on("error", function (err) {
                      done(err);
                    });
                    var wr = fs.createWriteStream(dstfile);
                    wr.on("error", function (err) {
                      done(err);
                    });
                    wr.on("close", function (ex) {
                      done();
                    });
                    rd.pipe(wr);
                  } else {
                    //console.log("file is present; " + file)
                    fs.symlink(srcfile, dstfile, function (err) {
                      if (err && err.code != "ENOENT") {
                        iterative_cb();
                      } else {
                        iterative_cb();
                      }
                    });
                  }
                });
              });
            },
            function (err, result) {
              filesNotPresent.forEach(function (file) {
                var index = effectiveAssets.indexOf(file);
                if (index > -1) effectiveAssets.splice(index, 1);
              });
              async_cb(err);
            }
          );
        });
      },
      function (async_cb) {
        var syncPath = path.join(config.syncDir, installation, group.name);
        fs.readdir(syncPath, function (err, data) {
          if (err) async_cb(err);
          else {
            var files = data.filter(function (file) {
              return file.charAt(0) != ".";
            });
            async.eachSeries(
              files,
              function (file, iterative_cb) {
                if (!file) return iterative_cb();

                if (effectiveAssets.indexOf(file) == -1) {
                  // Use effectiveAssets
                  fs.unlink(path.join(syncPath, file), function (err) {
                    iterative_cb();
                  });
                } else {
                  iterative_cb();
                }
              },
              function (err, result) {
                async_cb(err);
              }
            );
          }
        });
      },
      function (async_cb) {
        // brand video check (modified to skip banned special files)
        var specialFiles = [
          "brand_intro.mp4",
          "brand_intro_portrait.mp4",
          "welcome.ejs",
          "iot.zip",
        ];
        var filesAdded = [];
        async.eachSeries(
          specialFiles,
          function (file, iterative_cb) {
            Asset.findOne({ name: file }, function (err, asset) {
              if (err || !asset || asset.banned) {
                // If banned or error, unlink if exists and skip
                var syncPath = path.join(
                  config.syncDir,
                  installation,
                  group.name,
                  file
                );
                fs.unlink(syncPath, function (err) {
                  iterative_cb();
                });
              } else {
                // Not banned: proceed to symlink and add
                var syncPath = path.join(
                    config.syncDir,
                    installation,
                    group.name,
                    file
                  ),
                  mediaPath = path.join(config.mediaDir, file);
                fs.unlink(syncPath, function (err) {
                  fs.stat(mediaPath, function (err, stats) {
                    if (err || !stats.isFile()) iterative_cb();
                    else {
                      fs.symlink(mediaPath, syncPath, function (err) {
                        if (err && err.code != "ENOENT") {
                          console.log("error in creating symlink to " + file);
                        }
                        filesAdded.push(file);
                        iterative_cb();
                      });
                    }
                  });
                });
              }
            });
          },
          function (err, result) {
            effectiveAssets = effectiveAssets.concat(filesAdded); // Update effectiveAssets with non-banned specials
            group.assets = group.assets.concat(filesAdded); // Keep original group.assets updated for specials (as in original code)
            async_cb(err);
          }
        );
      },
      function (async_cb) {
        // send list of asset validity (queries on group.assets, but effectiveAssets is used for deploy)
        Asset.find(
          { "validity.enable": true, name: { $in: group.assets } },
          "name validity",
          function (err, data) {
            if (!err && data) {
              group.assetsValidity = data.map(function (asset) {
                return {
                  name: asset.name,
                  startdate: asset.validity.startdate,
                  enddate: asset.validity.enddate,
                  starthour: asset.validity.starthour,
                  endhour: asset.validity.endhour,
                };
              });
              //console.log(group.assetsValidity)
            } else {
              group.assetsValidity = [];
              util.log(
                "Asset validity query error for " + installation + ";" + err
              );
            }
            async_cb();
          }
        );
      },
    ],
    function (err, results) {
      group.deployedAssets = effectiveAssets; // Use filtered effectiveAssets for deployed
      group.deployedPlaylists = group.playlists;
      group.deployedTicker = group.ticker;

      if (err) {
        console.log("Error in deploy: ", err);
        return cb(err, group);
      }
      players[group._id.toString()].forEach(function (player) {
        var socketio = player.webSocket
          ? webSocket
          : player.newSocketIo
          ? newSocketio
          : oldSocketio;
        socketio.emitMessage(
          player.socket,
          "sync",
          group.playlists,
          effectiveAssets,
          group.deployedTicker, // Send effectiveAssets
          group.logo,
          group.logox,
          group.logoy,
          group.combineDefaultPlaylist,
          group.omxVolume,
          group.loadPlaylistOnCompletion,
          group.assetsValidity
        );
      });
      console.log("sending sync event to players");
      cb(null, group);
    }
  );
};
