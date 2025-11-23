'use strict';

var express = require('express'),
    path = require('path'),
    fs = require('fs'),
    config = require('./config'),
    serveIndex = require('serve-index');

var favicon = require('serve-favicon'),             //express middleware
    errorHandler = require('errorhandler'),
    logger = require('morgan'),
    methodOverride = require('method-override'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser');



// -----------------------------------------------------
// CORS Middleware — Allow all origins, methods, headers
// -----------------------------------------------------
var allowCrossDomain = function (req, res, next) {

    // Allow ALL origins
    res.header("Access-Control-Allow-Origin", "*");

    // IMPORTANT: When origin is "*", browser will reject credentials.
    // So we set credentials to false.
    res.header("Access-Control-Allow-Credentials", "false");

    // Allow ALL methods
    res.header(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD"
    );

    // Allow ALL request headers
    res.header("Access-Control-Allow-Headers", "*");

    // Allow ALL response headers to be exposed
    res.header("Access-Control-Expose-Headers", "*");

    // Preflight request response
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
};


// -----------------------------------------------------
// Basic HTTP Authentication (does NOT block CORS)
// -----------------------------------------------------
var basicHttpAuth = function (req, res, next) {

    // CORS preflight must always pass
    if (req.method === 'OPTIONS') {
        return next();
    }

    var auth = req.headers['authorization'];

    if (!auth) {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
        return res.end('<html><body>Authentication required to access this path</body></html>');
    }

    var tmp = auth.split(' ');
    var buf = Buffer.from(tmp[1], 'base64');
    var plain_auth = buf.toString();
    var creds = plain_auth.split(':');

    var username = creds[0];
    var password = creds[1];

    require('../app/controllers/licenses').getSettingsModel(function (err, settings) {
        if (
            (!settings.authCredentials) ||
            ((!settings.authCredentials.user || username === settings.authCredentials.user) &&
             (!settings.authCredentials.password || password === settings.authCredentials.password))
        ) {
            return next();
        } else {
            console.log("HTTP request rejected for " + req.path);
            res.statusCode = 401;
            res.setHeader('WWW-Authenticate', 'Basic realm="Secure Area"');
            return res.end('<html><body>Authentication required to access this path</body></html>');
        }
    });
};


// -----------------------------------------------------
// EXPORT APP CONFIGURATION
// -----------------------------------------------------
module.exports = function (app) {

    // CORS must be first
    app.use(allowCrossDomain);

    // Authentication after CORS
    app.use(basicHttpAuth);

    // Development config
    if (process.env.NODE_ENV == 'development') {

        app.use(function noCache(req, res, next) {
            if (req.url.indexOf('/scripts/') === 0) {
                res.header('Cache-Control', 'no-cache, no-store, must-revalidate');
                res.header('Pragma', 'no-cache');
                res.header('Expires', 0);
            }
            next();
        });

        app.use(errorHandler());
        app.locals.pretty = true;
        app.locals.compileDebug = true;
    }

    // Production assets
    if (process.env.NODE_ENV == 'production') {
        app.use(favicon(path.join(config.root, 'public/app/img', 'favicon.ico')));
    }

    // Sync folders
    app.use('/sync_folders', function (req, res, next) {
        delete req.headers['cache-control'];
        delete req.headers['pragma'];
        fs.stat(path.join(config.syncDir, req.path), function (err, stat) {
            if (!err && stat.isDirectory()) {
                res.setHeader('Last-Modified', new Date().toUTCString());
            }
            next();
        });
    }, serveIndex(config.syncDir));

    app.use('/sync_folders', express.static(config.syncDir));
    app.use('/releases', express.static(config.releasesDir));
    app.use('/licenses', express.static(config.licenseDir));
    app.use('/media', express.static(config.mediaDir));
    app.use(express.static(path.join(config.root, 'public')));

    // Template engine
    app.set('view engine', 'pug');
    app.locals.basedir = config.viewDir;
    app.set('views', config.viewDir);

    // Default middleware
    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(methodOverride());
    app.use(cookieParser());

    // App routes
    app.use(require('./routes'));

    // Error handler
    app.use(function (err, req, res, next) {
        if (err.message.indexOf('not found') >= 0) {
            return next();
        }

        if (err.message.indexOf('Range Not Satisfiable') >= 0) {
            return res.send();
        }

        console.error(err.stack);
        res.status(500).render('500');
    });

    // 404 handler
    app.use(function (req, res, next) {
        res.status(404).render('404', { url: req.originalUrl });
    });
};
