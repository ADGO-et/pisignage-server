'use strict';

angular.module('piAdvertisers.controllers', [])

    .controller('AdvertisersCtrl', function ($scope, $http, $state, piUrls, piPopup) {

        $scope.advertisers = [];
        $scope.loading = true;
        $scope.newAdvertiser = {};

        // Load advertisers
        $scope.loadAdvertisers = function () {
            $scope.loading = true;
            $http.get(piUrls.advertisers)
                .success(function (data) {
                    if (data.success) {
                        $scope.advertisers = data.data;
                    }
                    $scope.loading = false;
                })
                .error(function (data) {
                    console.log('Error loading advertisers:', data);
                    $scope.loading = false;
                });
        };

        // Create new advertiser
        $scope.createAdvertiser = function () {
            $state.go('home.advertisers.new');
        };

        // Edit advertiser
        $scope.editAdvertiser = function (advertiser) {
            $state.go('home.advertisers.edit', { id: advertiser._id });
        };

        // Delete advertiser
        $scope.deleteAdvertiser = function (advertiser) {
            piPopup.confirm(advertiser.name + ' Advertiser', function () {
                $http.delete(piUrls.advertisers + advertiser._id)
                    .success(function (data) {
                        if (data.success) {
                            $scope.loadAdvertisers();
                            piPopup.status({ msg: 'Advertiser deleted successfully', title: 'Success' });
                        } else {
                            piPopup.status({ msg: data.stat_message || 'Error deleting advertiser', title: 'Error' });
                        }
                    })
                    .error(function (data) {
                        piPopup.status({ msg: 'Error deleting advertiser', title: 'Error' });
                    });
            });
        };

        // Load advertisers on init
        $scope.loadAdvertisers();
    })

    .controller('AdvertiserDetailCtrl', function ($scope, $http, $state, $stateParams, piUrls, piPopup) {

        $scope.advertiser = {
            name: '',
            contactName: '',
            contactEmail: '',
            contactPhone: '',
            validTimeRange: {
                weekdays: [1, 2, 3, 4, 5, 6, 7],
                startDate: new Date(),
                endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days from now
            },
            active: true
        };

        $scope.isEdit = false;
        $scope.loading = false;

        // Weekday options
        $scope.weekdayOptions = [
            { id: 1, label: 'Monday' },
            { id: 2, label: 'Tuesday' },
            { id: 3, label: 'Wednesday' },
            { id: 4, label: 'Thursday' },
            { id: 5, label: 'Friday' },
            { id: 6, label: 'Saturday' },
            { id: 7, label: 'Sunday' }
        ];

        // Load advertiser if editing
        if ($stateParams.id) {
            $scope.isEdit = true;
            $scope.loading = true;
            $http.get(piUrls.advertisers + $stateParams.id)
                .success(function (data) {
                    if (data.success) {
                        $scope.advertiser = data.data;
                        // Convert dates to Date objects
                        $scope.advertiser.validTimeRange.startDate = new Date($scope.advertiser.validTimeRange.startDate);
                        $scope.advertiser.validTimeRange.endDate = new Date($scope.advertiser.validTimeRange.endDate);
                    }
                    $scope.loading = false;
                })
                .error(function (data) {
                    console.log('Error loading advertiser:', data);
                    $scope.loading = false;
                    $state.go('home.advertisers.list');
                });
        }

        // Toggle weekday selection
        $scope.toggleWeekday = function (day) {
            var idx = $scope.advertiser.validTimeRange.weekdays.indexOf(day);
            if (idx > -1) {
                $scope.advertiser.validTimeRange.weekdays.splice(idx, 1);
            } else {
                $scope.advertiser.validTimeRange.weekdays.push(day);
            }
            $scope.advertiser.validTimeRange.weekdays.sort();
        };

        // Check if weekday is selected
        $scope.isWeekdaySelected = function (day) {
            return $scope.advertiser.validTimeRange.weekdays.indexOf(day) > -1;
        };

        // Select all weekdays
        $scope.selectAllWeekdays = function () {
            $scope.advertiser.validTimeRange.weekdays = [1, 2, 3, 4, 5, 6, 7];
        };

        // Deselect all weekdays
        $scope.deselectAllWeekdays = function () {
            $scope.advertiser.validTimeRange.weekdays = [];
        };



        // Save advertiser
        $scope.saveAdvertiser = function () {
            if (!$scope.advertiser.name) {
                piPopup.status({ msg: 'Advertiser name is required', title: 'Validation Error' });
                return;
            }

            if ($scope.advertiser.validTimeRange.weekdays.length === 0) {
                piPopup.status({ msg: 'Please select at least one weekday', title: 'Validation Error' });
                return;
            }

            $scope.loading = true;

            var url = $scope.isEdit
                ? piUrls.advertisers + $scope.advertiser._id
                : piUrls.advertisers;

            $http.post(url, $scope.advertiser)
                .success(function (data) {
                    if (data.success) {
                        piPopup.status({
                            msg: $scope.isEdit ? 'Advertiser updated successfully' : 'Advertiser created successfully',
                            title: 'Success'
                        });
                        $state.go('home.advertisers.list');
                    } else {
                        piPopup.status({ msg: data.stat_message || 'Error saving advertiser', title: 'Error' });
                    }
                    $scope.loading = false;
                })
                .error(function (data) {
                    piPopup.status({ msg: 'Error saving advertiser', title: 'Error' });
                    $scope.loading = false;
                });
        };

        // Cancel
        $scope.cancel = function () {
            $state.go('home.advertisers.list');
        };
    });
