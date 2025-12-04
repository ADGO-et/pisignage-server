var mongoose = require('mongoose'),
    Schema = mongoose.Schema;

var PlaylistSchema = new Schema({
    name: { type: String, required: true, unique: true, index: true },
    description: String,
    assets: { type: [String], default: [] },
    settings: {
        durationEnable: { type: Boolean, default: false },
        startdate: Date,
        enddate: Date,
        timeEnable: { type: Boolean, default: false },
        starttime: String,
        endtime: String
    },
    schedule: {},
    metadata: {
        durationSeconds: { type: Number, default: 0 },
        advertiserNames: { type: [String], default: [] }
    },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now }
}, {
    usePushEach: true,
    minimize: false
});

PlaylistSchema.pre('save', function (next) {
    this.updatedAt = new Date();
    next();
});

PlaylistSchema.statics = {
    load: function (criteria, cb) {
        this.findOne(criteria).exec(cb);
    }
};

mongoose.model('Playlist', PlaylistSchema);
