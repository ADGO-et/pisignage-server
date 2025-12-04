'use strict'

angular.module('piSettings.controllers', []).
    controller('SettingsCtrl', function ($scope, $http, piUrls, $state, $modal, $window) {

        //licenses part

        $scope.savedFiles = []; // license files
        $scope.selectedFile = null; // Selected license for deletion
        $scope.statusMsg = null;

        $http.get(piUrls.licenses)
            .success(function (data) {
                if (data.success)
                    $scope.savedFiles = data.data;
                else
                    $scope.statusMsg = data.stat_message;

            }).error(function (err) {
                console.log(err);
            })
        $scope.upload = {
            onstart: function (files) {
                console.log('start upload');
            },
            ondone: function (files, data) {
                $scope.statusMsg = "Upload Complete";
                $state.reload();
            },
            onerror: function (files, type, msg) {
                $scope.statusMsg = 'Upload Error,' + type + ': ' + msg;
            }
        };
        $scope.deleteEntry = function (filename) { // delete license
            $scope.deleteText = ' license file ' + filename;
            $scope.modal = $modal.open({
                animation: true,
                scope: $scope,
                templateUrl: '/app/templates/confirm-popup.html'
            })
            $scope.ok = function () {
                $http.delete(piUrls.licenses + filename)
                    .success(function (data) {
                        if (data.success) {
                            $scope.modal.dismiss(); // close modal if successful
                            $scope.savedFiles = data.data;
                            $scope.selectedFile = null; // Reset selection
                        } else {
                            $scope.statusMsg = data.stat_message;
                        }

                    }).error(function (err) {
                    })
            }
            $scope.cancel = function () {
                $scope.modal.dismiss();
            }
        }

        //settings part
        $http.get(piUrls.settings)
            .success(function (data) {
                if (data.success)
                    $scope.settings = data.data;

            }).error(function (err) {
                console.log(err);
            })

        $scope.saveSettings = function () {
            $http.post(piUrls.settings, $scope.settings)
                .success(function (data, status) {
                    if (data.success) {
                    }
                    //if ($scope.settingsForm.user.$dirty) {
                    $scope.settingsForm.$setPristine();
                    $scope.loadMsg = "reloading..."
                    setTimeout($window.location.reload.bind($window.location), 2000);
                    //}
                })
                .error(function (data, status) {
                });
        }

        // Convert 24-hour time to 12-hour AM/PM format
        $scope.formatTime12Hour = function (time24) {
            if (!time24) return '';
            var parts = time24.split(':');
            var hours = parseInt(parts[0]);
            var minutes = parts[1];
            var ampm = hours >= 12 ? 'PM' : 'AM';
            hours = hours % 12;
            hours = hours ? hours : 12; // 0 should be 12
            return hours + ':' + minutes + ' ' + ampm;
        };

        // Calculate daily spots based on time window
        $scope.calculateDailySpots = function () {
            if (!$scope.settings || !$scope.settings.adTimeWindow ||
                !$scope.settings.adTimeWindow.enabled ||
                !$scope.settings.adTimeWindow.startTime ||
                !$scope.settings.adTimeWindow.endTime) {
                return 0;
            }

            var startTime = $scope.settings.adTimeWindow.startTime;
            var endTime = $scope.settings.adTimeWindow.endTime;

            var startParts = startTime.split(':');
            var endParts = endTime.split(':');

            var startSeconds = (parseInt(startParts[0]) * 3600) + (parseInt(startParts[1]) * 60);
            var endSeconds = (parseInt(endParts[0]) * 3600) + (parseInt(endParts[1]) * 60);

            // Handle case where end time is before start time (crosses midnight)
            if (endSeconds < startSeconds) {
                endSeconds += 24 * 3600;
            }

            var durationSeconds = endSeconds - startSeconds;
            var totalSpots = Math.floor(durationSeconds / 20);

            return totalSpots;
        };

    });