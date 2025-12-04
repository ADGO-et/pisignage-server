'use strict';

angular.module('piDeployments.controllers', [])

    .controller('DeploymentsCtrl', function ($scope, $http, piUrls, piPopup) {

        $scope.pendingPurchases = [];
        $scope.deployedPurchases = [];
        $scope.errorPurchases = [];
        $scope.pendingCount = 0;
        $scope.deployedCount = 0;
        $scope.errorCount = 0;
        $scope.deploying = false;
        $scope.deploymentResult = null;

        // Load purchases by status
        $scope.loadPurchasesByStatus = function (status) {
            $http.get(piUrls.base + 'api/spot-purchases/by-status/' + status)
                .success(function (data) {
                    if (data.success) {
                        if (status === 'pending') {
                            $scope.pendingPurchases = data.data;
                            $scope.pendingCount = data.data.length;
                        } else if (status === 'deployed') {
                            $scope.deployedPurchases = data.data;
                            $scope.deployedCount = data.data.length;
                        } else if (status === 'error') {
                            $scope.errorPurchases = data.data;
                            $scope.errorCount = data.data.length;
                        }
                    }
                })
                .error(function (data) {
                    console.log('Error loading purchases:', data);
                });
        };

        // Load all statuses
        $scope.loadAll = function () {
            $scope.loadPurchasesByStatus('pending');
            $scope.loadPurchasesByStatus('deployed');
            $scope.loadPurchasesByStatus('error');
        };

        // Deploy all pending purchases
        $scope.deployAll = function () {
            if ($scope.pendingCount === 0) {
                piPopup.status({ msg: 'No pending purchases to deploy', title: 'Info' });
                return;
            }

            $scope.deploying = true;
            $scope.deploymentResult = null;

            $http.post(piUrls.base + 'api/deployments/deploy-all')
                .success(function (data) {
                    $scope.deploying = false;
                    if (data.success) {
                        $scope.deploymentResult = data.data;
                        piPopup.status({
                            msg: 'Deployment completed! Deployed: ' + data.data.deployed + ', Errors: ' + data.data.errors,
                            title: 'Success'
                        });
                        // Reload all statuses
                        $scope.loadAll();
                    } else {
                        piPopup.status({ msg: data.stat_message || 'Error deploying purchases', title: 'Error' });
                    }
                })
                .error(function (data) {
                    $scope.deploying = false;
                    piPopup.status({ msg: 'Error deploying purchases', title: 'Error' });
                });
        };

        // Redeploy a single purchase
        $scope.redeployPurchase = function (purchaseId) {
            $http.post(piUrls.base + 'api/deployments/redeploy/' + purchaseId)
                .success(function (data) {
                    if (data.success) {
                        piPopup.status({ msg: 'Purchase redeployed successfully', title: 'Success' });
                        $scope.loadAll();
                    } else {
                        piPopup.status({ msg: data.stat_message || 'Error redeploying purchase', title: 'Error' });
                    }
                })
                .error(function (data) {
                    piPopup.status({ msg: 'Error redeploying purchase', title: 'Error' });
                });
        };

        // Format date
        $scope.formatDate = function (dateStr) {
            if (!dateStr) return '';
            return new Date(dateStr).toLocaleDateString();
        };

        // Initialize
        $scope.loadAll();
    });
