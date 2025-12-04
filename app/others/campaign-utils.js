'use strict';

var DAY_KEYS = ['1', '2', '3', '4', '5', '6', '7'];

function defaultWeekdayMap() {
    var map = {};
    DAY_KEYS.forEach(function (day) {
        map[day] = true;
    });
    return map;
}

function normalizeWeekdays(weekdays) {
    if (!weekdays) {
        return defaultWeekdayMap();
    }

    var normalized = {};

    if (Array.isArray(weekdays)) {
        weekdays.forEach(function (day) {
            if (!day && day !== 0) { return; }
            var key = day.toString();
            if (DAY_KEYS.indexOf(key) > -1) {
                normalized[key] = true;
            }
        });
        return Object.keys(normalized).length ? normalized : defaultWeekdayMap();
    }

    if (typeof weekdays === 'object') {
        Object.keys(weekdays).forEach(function (key) {
            if (DAY_KEYS.indexOf(key) > -1 && !!weekdays[key]) {
                normalized[key] = true;
            }
        });
        return Object.keys(normalized).length ? normalized : defaultWeekdayMap();
    }

    return defaultWeekdayMap();
}

function hasSelectedWeekday(weekdayMap) {
    if (!weekdayMap) {
        return false;
    }
    return Object.keys(weekdayMap).some(function (key) { return !!weekdayMap[key]; });
}

function calculateCampaignDaysFromMap(startDate, endDate, weekdayMap) {
    if (!startDate || !endDate) {
        return 0;
    }

    var start = new Date(startDate);
    var end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return 0;
    }

    start.setHours(0, 0, 0, 0);
    end.setHours(0, 0, 0, 0);

    if (end < start) {
        return 0;
    }

    var map = weekdayMap || defaultWeekdayMap();
    var count = 0;
    var current = new Date(start);

    while (current <= end) {
        var jsDay = current.getDay();
        var isoDay = jsDay === 0 ? 7 : jsDay;
        if (map[isoDay.toString()]) {
            count++;
        }
        current.setDate(current.getDate() + 1);
    }

    return count;
}

function calculateCampaignDays(startDate, endDate, weekdays) {
    var normalized = normalizeWeekdays(weekdays);
    return calculateCampaignDaysFromMap(startDate, endDate, normalized);
}

function calculateSpotTotals(sets, startDate, endDate, weekdays) {
    var normalizedWeekdays = normalizeWeekdays(weekdays);
    var numericSets = parseInt(sets, 10) || 0;
    var spotsPerDay = Math.max(0, numericSets * 40);
    var campaignDays = calculateCampaignDaysFromMap(startDate, endDate, normalizedWeekdays);

    return {
        weekdays: normalizedWeekdays,
        spotsPerDay: spotsPerDay,
        campaignDays: campaignDays,
        totalSpots: spotsPerDay * campaignDays
    };
}

module.exports = {
    normalizeWeekdays: normalizeWeekdays,
    hasSelectedWeekday: hasSelectedWeekday,
    calculateCampaignDays: calculateCampaignDays,
    calculateSpotTotals: calculateSpotTotals
};
