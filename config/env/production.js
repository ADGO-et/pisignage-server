'use strict';

module.exports = {
    env: 'production',
    https: false,
    port: process.env.PORT || 1242,
    mongo: {
        uri: process.env.MONGOLAB_URI ||
            'mongodb://pisignageUser2:AnotherStrongPass123@127.0.0.1:27017/pisignage-server-dev-2?authSource=pisignage-dev-2'
    }
};


