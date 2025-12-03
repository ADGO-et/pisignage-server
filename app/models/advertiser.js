var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var AdvertiserSchema = new Schema({
    name: { type: String, required: true, index: true },
    contactName: String,
    contactEmail: String,
    contactPhone: String,

    validTimeRange: {
        // Days of week: 1=Monday, 2=Tuesday, ..., 7=Sunday
        weekdays: { type: [Number], default: [1, 2, 3, 4, 5, 6, 7] },

        // Date range
        startDate: { type: Date, required: true },
        endDate: { type: Date, required: true }
    },

    // Spot tracking
    totalSpotsPurchased: { type: Number, default: 0 },
    totalSpotsRemaining: { type: Number, default: 0 },

    // Status
    active: { type: Boolean, default: true },

    // Metadata
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    createdBy: { _id: { type: Schema.ObjectId, ref: 'User' }, name: String }
}, {
    usePushEach: true
});

// Validation
AdvertiserSchema.path('name').validate(function (name) {
    return name && name.length > 0;
}, 'Advertiser name cannot be blank');

AdvertiserSchema.path('validTimeRange.startDate').validate(function (startDate) {
    return startDate && startDate <= this.validTimeRange.endDate;
}, 'Start date must be before or equal to end date');

AdvertiserSchema.path('validTimeRange.weekdays').validate(function (weekdays) {
    return weekdays && weekdays.length > 0 && weekdays.every(d => d >= 1 && d <= 7);
}, 'Weekdays must be between 1 and 7');

// Update timestamp on save
AdvertiserSchema.pre('save', function (next) {
    this.updatedAt = Date.now();
    next();
});

// Static methods
AdvertiserSchema.statics = {
    load: function (id, cb) {
        this.findOne({ _id: id }).exec(cb);
    },

    list: function (options, cb) {
        var criteria = options.criteria || {};

        this.find(criteria)
            .sort({ name: 1 })
            .limit(options.perPage || 100)
            .skip((options.perPage || 100) * (options.page || 0))
            .exec(cb);
    },

    // Get active advertisers for a specific date/time
    getActiveAdvertisers: function (currentDate, cb) {
        var dayOfWeek = currentDate.getDay() || 7; // Convert Sunday from 0 to 7

        this.find({
            active: true,
            'validTimeRange.startDate': { $lte: currentDate },
            'validTimeRange.endDate': { $gte: currentDate },
            'validTimeRange.weekdays': dayOfWeek,
            totalSpotsRemaining: { $gt: 0 }
        }).exec(cb);
    }
};

mongoose.model('Advertiser', AdvertiserSchema);
