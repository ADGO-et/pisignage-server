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
                if (data.success) {
                    $scope.settings = data.data;

                    // Convert ISO date strings to HH:MM format for time inputs
                    if ($scope.settings.adTimeWindow) {
                        if ($scope.settings.adTimeWindow.startTime) {
                            $scope.settings.adTimeWindow.startTime = extractTimeFromISO($scope.settings.adTimeWindow.startTime);
                        }
                        if ($scope.settings.adTimeWindow.endTime) {
                            $scope.settings.adTimeWindow.endTime = extractTimeFromISO($scope.settings.adTimeWindow.endTime);
                        }
                    }
                }

            }).error(function (err) {
                console.log(err);
            })

        $scope.saveSettings = function () {
            console.log('Saving settings...');
            // Create a copy to avoid modifying the original
            var settingsToSave = angular.copy($scope.settings);

            // Ensure time is in HH:MM format (not ISO date)
            if (settingsToSave.adTimeWindow) {
                if (settingsToSave.adTimeWindow.startTime) {
                    settingsToSave.adTimeWindow.startTime = extractTimeFromISO(settingsToSave.adTimeWindow.startTime);
                }
                if (settingsToSave.adTimeWindow.endTime) {
                    settingsToSave.adTimeWindow.endTime = extractTimeFromISO(settingsToSave.adTimeWindow.endTime);
                }
            }

            $http.post(piUrls.settings, settingsToSave)
                .success(function (data, status) {
                    if (data.success) {
                        console.log('Settings saved successfully');
                    }
                    //if ($scope.settingsForm.user.$dirty) {
                    $scope.settingsForm.$setPristine();
                    $scope.loadMsg = "reloading..."
                    setTimeout($window.location.reload.bind($window.location), 2000);
                    //}
                })
                .error(function (data, status) {
                    console.error('Error saving settings:', data);
                });
        }

        // Helper function to extract HH:MM from ISO date or return as-is if already in HH:MM format
        function extractTimeFromISO(timeStr) {
            if (!timeStr) return '';

            // If it's a Date object
            if (timeStr instanceof Date) {
                var hours = ('0' + timeStr.getHours()).slice(-2);
                var minutes = ('0' + timeStr.getMinutes()).slice(-2);
                return hours + ':' + minutes;
            }

            // Ensure it's a string
            timeStr = String(timeStr);

            // If it's already in HH:MM format, return it
            if (/^\d{2}:\d{2}$/.test(timeStr)) {
                return timeStr;
            }

            // If it's an ISO date string, extract the time
            if (timeStr.indexOf('T') !== -1) {
                var date = new Date(timeStr);
                var hours = ('0' + date.getUTCHours()).slice(-2);
                var minutes = ('0' + date.getUTCMinutes()).slice(-2);
                return hours + ':' + minutes;
            }

            return timeStr;
        }

        // Convert 24-hour time to 12-hour AM/PM format
        $scope.formatTime12Hour = function (time24) {
            if (!time24) return '';
            // Handle Date objects
            if (time24 instanceof Date) {
                time24 = extractTimeFromISO(time24);
            }

            var parts = time24.split(':');
            if (parts.length < 2) return time24;

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

            var startTime = extractTimeFromISO($scope.settings.adTimeWindow.startTime);
            var endTime = extractTimeFromISO($scope.settings.adTimeWindow.endTime);

            var startParts = startTime.split(':');
            var endParts = endTime.split(':');

            if (startParts.length < 2 || endParts.length < 2) return 0;

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