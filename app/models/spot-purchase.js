var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

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
        required: true,
        default: function () {
            return this.sets ? this.sets * 40 : 0;
        }
    }, // sets * 40
    spotsRemaining: {
        type: Number,
        required: true,
        default: function () {
            var total = this.totalSpots || (this.sets ? this.sets * 40 : 0);
            return total;
        }
    },

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

// Ensure computed fields exist before validation runs
SpotPurchaseSchema.pre('validate', function (next) {
    var sets = this.sets || 0;
    if (!this.totalSpots) {
        this.totalSpots = sets * 40;
    }

    if (!this.spotsRemaining && this.isNew) {
        this.spotsRemaining = this.totalSpots;
    }

    if (!this.totalPrice) {
        this.totalPrice = (this.pricePerSet || 0) * sets;
    }

    next();
});

// Validation
SpotPurchaseSchema.path('sets').validate(function (sets) {
    return sets && sets > 0;
}, 'Sets must be greater than 0');

SpotPurchaseSchema.path('adAsset.duration').validate(function (duration) {
    return duration === 20;
}, 'Ad asset duration must be exactly 20 seconds for spot-based advertising');

// Pre-save hook to calculate total spots
SpotPurchaseSchema.pre('save', function (next) {
    if (this.isNew || this.isModified('sets')) {
        this.totalSpots = this.sets * 40;
        if (this.isNew) {
            this.spotsRemaining = this.totalSpots;
        }
    }

    if (this.isModified('pricePerSet') || this.isModified('sets')) {
        this.totalPrice = this.pricePerSet * this.sets;
    }

    // Mark as fully consumed if no spots remaining
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
