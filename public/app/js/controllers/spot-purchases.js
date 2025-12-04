'use strict';

angular.module('piSpotPurchases.controllers', [])

    .controller('SpotPurchasesCtrl', function ($scope, $http, piUrls, piPopup, assetLoader, $state, $stateParams) {

        $scope.advertisers = [];
        $scope.assets = [];
        $scope.groups = [];

        function defaultWeekdaySelection() {
            return {
                1: true,
                2: true,
                3: true,
                4: true,
                5: true,
                6: true,
                7: true
            };
        }

        function createEmptyPurchase() {
            return {
                advertiserId: null,
                adAsset: {
                    filename: null,
                    duration: 20
                },
                sets: 1,
                pricePerSet: 0,
                startDate: null,
                endDate: null,
                targetGroups: [],
                weekdays: defaultWeekdaySelection()
            };
        }

        $scope.purchase = createEmptyPurchase();
        $scope.isEditing = false;
        $scope.editingPurchaseId = null;
        var requestedPurchaseId = $stateParams.purchaseId || null;
        var purchaseDetailsLoaded = false;

        $scope.loading = false;
        $scope.purchases = [];
        $scope.selectedAdvertiser = null;
        $scope.availabilityChecking = false;
        $scope.availabilityResult = null;

        function ensureAdvertiserInList(advertiser) {
            if (!advertiser || !advertiser._id) return;
            var exists = $scope.advertisers.some(function (adv) { return adv._id === advertiser._id; });
            if (!exists) {
                $scope.advertisers.push(advertiser);
            }
        }

        function normalizeId(id) {
            if (id === null || id === undefined) return id;
            return id.toString ? id.toString() : id;
        }

        function mapTargetGroupsForForm(targetGroups) {
            return (targetGroups || []).map(function (group) {
                if (!group) return group;
                return normalizeId(group._id || group);
            });
        }

        function resetPurchaseForm() {
            $scope.purchase = createEmptyPurchase();
            $scope.selectedAdvertiser = null;
            $scope.purchases = [];
            $scope.availabilityResult = null;
        }

        $scope.cancelEdit = function () {
            resetPurchaseForm();
            $scope.isEditing = false;
            $scope.editingPurchaseId = null;
            $state.go('home.spotpurchase', {}, { reload: true });
        };

        $scope.loadPurchaseDetails = function (purchaseId) {
            if (!purchaseId) return;
            $scope.loading = true;

            $http.get(piUrls.spotPurchases + purchaseId)
                .success(function (data) {
                    $scope.loading = false;
                    if (!data.success || !data.data) {
                        piPopup.status({ msg: data.stat_message || 'Unable to load purchase details', title: 'Error' });
                        return $state.go('home.purchases');
                    }

                    var purchase = data.data;
                    purchaseDetailsLoaded = true;
                    $scope.isEditing = true;
                    $scope.editingPurchaseId = purchase._id;
                    ensureAdvertiserInList(purchase.advertiser);

                    $scope.purchase = {
                        advertiserId: purchase.advertiser && purchase.advertiser._id,
                        adAsset: angular.copy(purchase.adAsset) || { filename: null, duration: 20 },
                        sets: purchase.sets,
                        pricePerSet: purchase.pricePerSet || 0,
                        startDate: new Date(purchase.startDate),
                        endDate: new Date(purchase.endDate),
                        targetGroups: mapTargetGroupsForForm(purchase.targetGroups),
                        weekdays: angular.copy(purchase.weekdays) || defaultWeekdaySelection(),
                        expirationDate: purchase.expirationDate
                    };

                    if (!$scope.purchase.weekdays) {
                        $scope.purchase.weekdays = defaultWeekdaySelection();
                    }

                    $scope.selectedAdvertiser = purchase.advertiser;
                    $scope.purchases = [];
                    $scope.availabilityResult = null;
                })
                .error(function () {
                    $scope.loading = false;
                    piPopup.status({ msg: 'Unable to load purchase details', title: 'Error' });
                    $state.go('home.purchases');
                });
        };

        // Load advertisers
        $scope.loadAdvertisers = function () {
            $http.get(piUrls.advertisers)
                .success(function (data) {
                    if (data.success) {
                        $scope.advertisers = data.data.filter(function (adv) {
                            return adv.active;
                        });

                        if ($scope.selectedAdvertiser) {
                            ensureAdvertiserInList($scope.selectedAdvertiser);
                        }
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

        // Calculate days in range (excluding unselected weekdays)
        $scope.calculateDaysInRange = function () {
            if (!$scope.purchase.startDate || !$scope.purchase.endDate) return 0;
            var start = new Date($scope.purchase.startDate);
            var end = new Date($scope.purchase.endDate);

            var totalDays = 0;
            var currentDate = new Date(start);

            while (currentDate <= end) {
                // Get day of week (1=Monday, 7=Sunday)
                var dayOfWeek = currentDate.getDay();
                // Convert JS day (0=Sunday, 6=Saturday) to our format (1=Monday, 7=Sunday)
                var ourDayFormat = dayOfWeek === 0 ? 7 : dayOfWeek;

                // Check if this day is selected
                if ($scope.purchase.weekdays[ourDayFormat]) {
                    totalDays++;
                }

                currentDate.setDate(currentDate.getDate() + 1);
            }

            return totalDays;
        };

        // Get count of selected weekdays
        $scope.getSelectedWeekdaysCount = function () {
            var count = 0;
            for (var day in $scope.purchase.weekdays) {
                if ($scope.purchase.weekdays[day]) count++;
            }
            return count;
        };

        // Calculate total price
        $scope.calculateTotalPrice = function () {
            return $scope.purchase.sets * $scope.purchase.pricePerSet;
        };

        // Toggle group selection
        $scope.toggleGroup = function (groupId) {
            var normalizedId = normalizeId(groupId);
            var idx = $scope.purchase.targetGroups.indexOf(normalizedId);
            if (idx > -1) {
                $scope.purchase.targetGroups.splice(idx, 1);
            } else {
                $scope.purchase.targetGroups.push(normalizedId);
            }
        };

        // Check if group is selected
        $scope.isGroupSelected = function (groupId) {
            var normalizedId = normalizeId(groupId);
            return $scope.purchase.targetGroups.indexOf(normalizedId) > -1;
        };

        // Check availability
        $scope.checkAvailability = function () {
            if (!$scope.purchase.startDate || !$scope.purchase.endDate || !$scope.purchase.sets) {
                $scope.availabilityResult = null;
                return;
            }

            $scope.availabilityChecking = true;
            $scope.availabilityResult = null;

            var availabilityPayload = {
                startDate: $scope.purchase.startDate,
                endDate: $scope.purchase.endDate,
                spotsPerDay: $scope.calculateSpotsPerDay()
            };

            if ($scope.isEditing && $scope.editingPurchaseId) {
                availabilityPayload.excludePurchaseId = $scope.editingPurchaseId;
            }

            $http.post(piUrls.base + 'api/spot-availability/check', availabilityPayload)
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
            var isEditingRequest = $scope.isEditing && $scope.editingPurchaseId;
            var endpoint = isEditingRequest ? (piUrls.spotPurchases + $scope.editingPurchaseId) : piUrls.spotPurchases;

            $http.post(endpoint, $scope.purchase)
                .success(function (data) {
                    $scope.loading = false;
                    if (data.success) {
                        if (isEditingRequest) {
                            piPopup.status({ msg: 'Spot purchase updated successfully.', title: 'Success' });
                            $state.go('home.purchases');
                        } else {
                            var totalSpots = $scope.calculateSpotsPerDay() * $scope.calculateDaysInRange();
                            piPopup.status({
                                msg: 'Spot purchase successful! ' + totalSpots + ' spots added.',
                                title: 'Success'
                            });

                            $scope.purchase.adAsset.filename = null;
                            $scope.purchase.sets = 1;
                            $scope.purchase.startDate = null;
                            $scope.purchase.endDate = null;
                            $scope.purchase.targetGroups = [];
                            $scope.availabilityResult = null;

                            $scope.loadAdvertiserPurchases();
                            $scope.loadAdvertisers();
                        }
                    } else {
                        piPopup.status({ msg: data.stat_message || 'Error purchasing spots', title: 'Error' });
                    }
                })
                .error(function () {
                    $scope.loading = false;
                    piPopup.status({ msg: 'Error purchasing spots', title: 'Error' });
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

        if (requestedPurchaseId) {
            $scope.loadPurchaseDetails(requestedPurchaseId);
        }
    });
