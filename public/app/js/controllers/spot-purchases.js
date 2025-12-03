'use strict';

angular.module('piSpotPurchases.controllers', [])

    .controller('SpotPurchasesCtrl', function ($scope, $http, piUrls, piPopup, assetLoader) {

        $scope.advertisers = [];
        $scope.assets = [];
        $scope.purchase = {
            advertiserId: null,
            adAsset: {
                filename: null,
                duration: 20
            },
            sets: 1,
            pricePerSet: 0
        };

        $scope.loading = false;
        $scope.purchases = [];
        $scope.selectedAdvertiser = null;

        // Load advertisers
        $scope.loadAdvertisers = function () {
            $http.get(piUrls.base + '/advertisers')
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

        // Load assets
        $scope.loadAssets = function () {
            $http.get(piUrls.files)
                .success(function (data) {
                    if (data.success) {
                        // Filter for video files only (20, 40, or 60 seconds)
                        $scope.assets = data.data.files.filter(function (file) {
                            var filename = file.toLowerCase();
                            return filename.match(/\\.(mp4|avi|mov|mkv|webm|flv)$/);
                        });
                    }
                })
                .error(function (data) {
                    console.log('Error loading assets:', data);
                });
        };

        // Calculate total spots
        $scope.calculateTotalSpots = function () {
            return $scope.purchase.sets * 40;
        };

        // Calculate total price
        $scope.calculateTotalPrice = function () {
            return $scope.purchase.sets * $scope.purchase.pricePerSet;
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

            $http.get(piUrls.base + '/spot-purchases/advertiser/' + $scope.purchase.advertiserId)
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

            $scope.loading = true;

            $http.post(piUrls.base + '/spot-purchases', $scope.purchase)
                .success(function (data) {
                    if (data.success) {
                        piPopup.status({
                            msg: 'Spot purchase successful! ' + $scope.calculateTotalSpots() + ' spots added.',
                            title: 'Success'
                        });

                        // Reset form
                        $scope.purchase.adAsset.filename = null;
                        $scope.purchase.sets = 1;

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
    });
