'use strict';

angular.module('piSpotPurchases.controllers', [])

    .controller('SpotPurchasesCtrl', function ($scope, $http, piUrls, piPopup, assetLoader) {

        $scope.advertisers = [];
        $scope.assets = [];
        $scope.groups = [];
        $scope.purchase = {
            advertiserId: null,
            adAsset: {
                filename: null,
                duration: 20
            },
            sets: 1,
            pricePerSet: 0,
            startDate: null,
            endDate: null,
            targetGroups: []
        };

        $scope.loading = false;
        $scope.purchases = [];
        $scope.selectedAdvertiser = null;
        $scope.availabilityChecking = false;
        $scope.availabilityResult = null;

        // Load advertisers
        $scope.loadAdvertisers = function () {
            $http.get(piUrls.advertisers)
                .success(function (data) {
                    if (data.success) {
                        $scope.advertisers = data.data.filter(function (adv) {
                            return adv.active;
                        });
                    }
                })
                .error(function (data) {
                    console.log('Error loading advertisers:', data);
                });
        };

        // Load assets (videos and images allowed)
        $scope.loadAssets = function () {
            $http.get(piUrls.files)
                .success(function (data) {
                    if (data.success) {
                        var allowedExtensions = /\.(mp4|avi|mov|mkv|webm|flv|mpg|mpeg|jpg|jpeg|png|gif|bmp|webp)$/;
                        $scope.assets = data.data.files.filter(function (file) {
                            return allowedExtensions.test(file.toLowerCase());
                        });
                    }
                })
                .error(function (data) {
                    console.log('Error loading assets:', data);
                });
        };

        // Load groups
        $scope.loadGroups = function () {
            $http.get(piUrls.groups)
                .success(function (data) {
                    if (data.success) {
                        $scope.groups = data.data;
                    }
                })
                .error(function (data) {
                    console.log('Error loading groups:', data);
                });
        };

        // Calculate total spots (per day)
        $scope.calculateTotalSpots = function () {
            return $scope.purchase.sets * 40;
        };

        // Calculate spots per day (same as total spots since spots are per day)
        $scope.calculateSpotsPerDay = function () {
            return $scope.calculateTotalSpots();
        };

        // Calculate days in range
        $scope.calculateDaysInRange = function () {
            if (!$scope.purchase.startDate || !$scope.purchase.endDate) return 0;
            var start = new Date($scope.purchase.startDate);
            var end = new Date($scope.purchase.endDate);
            var diffTime = Math.abs(end - start);
            var diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1;
            return diffDays;
        };

        // Calculate total price
        $scope.calculateTotalPrice = function () {
            return $scope.purchase.sets * $scope.purchase.pricePerSet;
        };

        // Toggle group selection
        $scope.toggleGroup = function (groupId) {
            var idx = $scope.purchase.targetGroups.indexOf(groupId);
            if (idx > -1) {
                $scope.purchase.targetGroups.splice(idx, 1);
            } else {
                $scope.purchase.targetGroups.push(groupId);
            }
        };

        // Check if group is selected
        $scope.isGroupSelected = function (groupId) {
            return $scope.purchase.targetGroups.indexOf(groupId) > -1;
        };

        // Check availability
        $scope.checkAvailability = function () {
            if (!$scope.purchase.startDate || !$scope.purchase.endDate || !$scope.purchase.sets) {
                $scope.availabilityResult = null;
                return;
            }

            $scope.availabilityChecking = true;
            $scope.availabilityResult = null;

            $http.post(piUrls.base + 'api/spot-availability/check', {
                startDate: $scope.purchase.startDate,
                endDate: $scope.purchase.endDate,
                spotsPerDay: $scope.calculateSpotsPerDay()
            })
                .success(function (data) {
                    $scope.availabilityChecking = false;
                    if (data.success) {
                        $scope.availabilityResult = data.data;
                    }
                })
                .error(function (data) {
                    $scope.availabilityChecking = false;
                    console.log('Error checking availability:', data);
                });
        };

        // When advertiser is selected
        $scope.onAdvertiserSelected = function () {
            if ($scope.purchase.advertiserId) {
                // Find the selected advertiser
                $scope.selectedAdvertiser = $scope.advertisers.find(function (adv) {
                    return adv._id === $scope.purchase.advertiserId;
                });

                // Load purchases for this advertiser
                $scope.loadAdvertiserPurchases();
            } else {
                $scope.selectedAdvertiser = null;
                $scope.purchases = [];
            }
        };

        // Load purchases for selected advertiser
        $scope.loadAdvertiserPurchases = function () {
            if (!$scope.purchase.advertiserId) return;

            $http.get(piUrls.spotPurchases + 'advertiser/' + $scope.purchase.advertiserId)
                .success(function (data) {
                    if (data.success) {
                        $scope.purchases = data.data;
                    }
                })
                .error(function (data) {
                    console.log('Error loading purchases:', data);
                });
        };

        // Purchase spots
        $scope.purchaseSpots = function () {
            if (!$scope.purchase.advertiserId) {
                piPopup.status({ msg: 'Please select an advertiser', title: 'Validation Error' });
                return;
            }

            if (!$scope.purchase.adAsset.filename) {
                piPopup.status({ msg: 'Please select an ad asset', title: 'Validation Error' });
                return;
            }

            if ($scope.purchase.sets < 1) {
                piPopup.status({ msg: 'Number of sets must be at least 1', title: 'Validation Error' });
                return;
            }

            if (!$scope.purchase.startDate || !$scope.purchase.endDate) {
                piPopup.status({ msg: 'Please select campaign start and end dates', title: 'Validation Error' });
                return;
            }

            if ($scope.purchase.targetGroups.length === 0) {
                piPopup.status({ msg: 'Please select at least one target group', title: 'Validation Error' });
                return;
            }

            if ($scope.availabilityResult && !$scope.availabilityResult.valid) {
                piPopup.status({ msg: 'Not enough available spots. Please reduce quantity or select different dates.', title: 'Validation Error' });
                return;
            }

            $scope.loading = true;

            $http.post(piUrls.spotPurchases, $scope.purchase)
                .success(function (data) {
                    if (data.success) {
                        piPopup.status({
                            msg: 'Spot purchase successful! ' + ($scope.calculateSpotsPerDay() * $scope.calculateDaysInRange()) + ' spots added.',
                            title: 'Success'
                        });

                        // Reset form
                        $scope.purchase.adAsset.filename = null;
                        $scope.purchase.sets = 1;
                        $scope.purchase.startDate = null;
                        $scope.purchase.endDate = null;
                        $scope.purchase.targetGroups = [];
                        $scope.availabilityResult = null;

                        // Reload purchases
                        $scope.loadAdvertiserPurchases();
                        $scope.loadAdvertisers(); // Refresh to update spot counts
                    } else {
                        piPopup.status({ msg: data.stat_message || 'Error purchasing spots', title: 'Error' });
                    }
                    $scope.loading = false;
                })
                .error(function (data) {
                    piPopup.status({ msg: 'Error purchasing spots', title: 'Error' });
                    $scope.loading = false;
                });
        };

        // Format date
        $scope.formatDate = function (dateStr) {
            return new Date(dateStr).toLocaleDateString();
        };

        // Initialize
        $scope.loadAdvertisers();
        $scope.loadAssets();
        $scope.loadGroups();
    });
