var mongoose = require('mongoose'),
    Schema = mongoose.Schema,
    campaignUtils = require('../others/campaign-utils');

var SpotPurchaseSchema = new Schema({
    advertiser: {
        _id: { type: Schema.ObjectId, ref: 'Advertiser', required: true },
        name: String
    },

    // Ad asset reference
    adAsset: {
        filename: { type: String, required: true },
        duration: { type: Number, default: 20 } // Should always be 20 for spots
    },

    // Purchase details
    sets: { type: Number, required: true, min: 1 }, // Number of sets purchased (1 set = 40 spots)
    totalSpots: {
        type: Number,
        default: function () {
            return this.sets ? this.sets * 40 : 0;
        }
    }, // sets * 40
    spotsRemaining: {
        type: Number,
        default: function () {
            var total = this.totalSpots || (this.sets ? this.sets * 40 : 0);
            return total;
        }
    },
    spotsPerDay: { type: Number }, // Spots allocated per day
    campaignDays: { type: Number, default: 1 },

    // Campaign date range
    startDate: { type: Date, required: true },
    endDate: { type: Date, required: true },

    // Days of week when ads should display (1=Monday, 7=Sunday)
    weekdays: {
        type: Schema.Types.Mixed,
        default: function () {
            return {
                1: true, 2: true, 3: true, 4: true,
                5: true, 6: true, 7: true
            };
        }
    },

    // Target groups for deployment
    targetGroups: [{ type: Schema.ObjectId, ref: 'Group' }],

    // Pricing (optional for future use)
    pricePerSet: { type: Number, default: 0 },
    totalPrice: {
        type: Number,
        default: function () {
            return (this.pricePerSet || 0) * (this.sets || 0);
        }
    },

    // Status
    active: { type: Boolean, default: true },
    fullyConsumed: { type: Boolean, default: false },

    // Deployment tracking
    deploymentStatus: {
        type: String,
        enum: ['pending', 'deployed', 'error'],
        default: 'pending'
    },
    deployedAt: Date,
    deploymentError: String,

    // Metadata
    purchaseDate: { type: Date, default: Date.now },
    expirationDate: Date, // Optional expiration
    createdBy: { _id: { type: Schema.ObjectId, ref: 'User' }, name: String },

    // Tracking
    lastPlayedAt: Date,
    playCount: { type: Number, default: 0 }
}, {
    usePushEach: true
});

function shouldRecalculate(doc) {
    return doc.isNew ||
        doc.isModified('sets') ||
        doc.isModified('startDate') ||
        doc.isModified('endDate') ||
        doc.isModified('weekdays');
}

// Ensure computed fields exist before validation runs
SpotPurchaseSchema.pre('validate', function (next) {
    var doc = this;
    doc.weekdays = campaignUtils.normalizeWeekdays(doc.weekdays);

    if (!campaignUtils.hasSelectedWeekday(doc.weekdays)) {
        return next(new Error('Please select at least one weekday for this campaign'));
    }

    if (shouldRecalculate(doc)) {
        var quantities = campaignUtils.calculateSpotTotals(doc.sets || 0, doc.startDate, doc.endDate, doc.weekdays);

        if (!quantities.campaignDays) {
            return next(new Error('Campaign must include at least one valid day within the selected range'));
        }

        doc.spotsPerDay = quantities.spotsPerDay;
        doc.campaignDays = quantities.campaignDays;
        doc.totalSpots = quantities.totalSpots;
        doc.spotsRemaining = doc.totalSpots;
    }

    if (doc.totalPrice === undefined || doc.totalPrice === null || doc.isModified('pricePerSet') || doc.isModified('sets')) {
        doc.totalPrice = (doc.pricePerSet || 0) * (doc.sets || 0);
    }

    doc.fullyConsumed = doc.spotsRemaining <= 0;
    doc.active = !doc.fullyConsumed;

    next();
});

// Validation for date range
SpotPurchaseSchema.path('startDate').validate(function (startDate) {
    if (!this.endDate) return true;
    return startDate <= this.endDate;
}, 'Start date must be before or equal to end date');

// Validation
SpotPurchaseSchema.path('sets').validate(function (sets) {
    return sets && sets > 0;
}, 'Sets must be greater than 0');

SpotPurchaseSchema.path('adAsset.duration').validate(function (duration) {
    return duration === 20;
}, 'Ad asset duration must be exactly 20 seconds for spot-based advertising');

// Pre-save hook to calculate total spots
SpotPurchaseSchema.pre('save', function (next) {
    if (this.spotsRemaining <= 0) {
        this.fullyConsumed = true;
        this.active = false;
    }
    next();
});

// Static methods
SpotPurchaseSchema.statics = {
    load: function (id, cb) {
        this.findOne({ _id: id })
            .populate('advertiser._id')
            .exec(cb);
    },

    list: function (options, cb) {
        var criteria = options.criteria || {};

        this.find(criteria)
            .populate('advertiser._id')
            .sort({ purchaseDate: -1 })
            .limit(options.perPage || 100)
            .skip((options.perPage || 100) * (options.page || 0))
            .exec(cb);
    },

    // Get purchases for a specific advertiser
    getByAdvertiser: function (advertiserId, cb) {
        this.find({ 'advertiser._id': advertiserId, active: true })
            .sort({ purchaseDate: -1 })
            .exec(cb);
    },

    // Get active purchases with remaining spots
    getActivePurchases: function (advertiserId, cb) {
        this.find({
            'advertiser._id': advertiserId,
            active: true,
            spotsRemaining: { $gt: 0 }
        })
            .sort({ purchaseDate: 1 }) // Oldest first (FIFO)
            .exec(cb);
    },

    // Decrement spots for a purchase
    decrementSpots: function (purchaseId, spotsUsed, cb) {
        this.findById(purchaseId, function (err, purchase) {
            if (err || !purchase) return cb(err || 'Purchase not found');

            purchase.spotsRemaining = Math.max(0, purchase.spotsRemaining - spotsUsed);
            purchase.playCount += spotsUsed;
            purchase.lastPlayedAt = Date.now();

            purchase.save(cb);
        });
    }
};

mongoose.model('SpotPurchase', SpotPurchaseSchema);
