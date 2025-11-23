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


// ---------------------------------------------
// CORS Middleware
// ---------------------------------------------
var allowCrossDomain = function (req, res, next) {
    const allowedOrigins = [
        "http://localhost:3000",
        "https://your-production-domain.com"
    ];

    const origin = req.headers.origin;

    if (allowedOrigins.includes(origin)) {
        res.header("Access-Control-Allow-Origin", origin);
    }

    res.header("Access-Control-Allow-Credentials", "true");
    res.header("Vary", "Origin");
    res.header("Access-Control-Expose-Headers", "Content-Length");

    // ★ Include PATCH here
    res.header(
        "Access-Control-Allow-Methods",
        "HEAD, GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );

    res.header(
        "Access-Control-Allow-Headers",
        "Content-Type, Content-Length, Response-Type, X-Requested-With, Origin, Accept, Authorization, x-access-token, Last-Modified"
    );

    // ★ Allow OPTIONS request to continue to PATCH/DELETE/PUT
    if (req.method === "OPTIONS") {
        return res.sendStatus(204);
    }

    next();
};


// ---------------------------------------------
// Basic HTTP Authentication Middleware
// (Modified to allow OPTIONS preflight)
// ---------------------------------------------
var basicHttpAuth = function (req, res, next) {

    // ★ PREVENT blocking preflight requests
    if (req.method === "OPTIONS") {
        return next();
    }

    var auth = req.headers["authorization"];

    if (!auth) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"');
        return res.end("<html><body>Authentication required to access this path</body></html>");
    }

    var tmp = auth.split(" ");
    var buf = Buffer.from(tmp[1], "base64");
    var plain_auth = buf.toString();
    var creds = plain_auth.split(":");

    var username = creds[0];
    var password = creds[1];

    require("../app/controllers/licenses").getSettingsModel(function (err, settings) {
        if (
            (!settings.authCredentials) ||
            ((!settings.authCredentials.user || username == settings.authCredentials.user) &&
            (!settings.authCredentials.password || password == settings.authCredentials.password))
        ) {
            return next();
        } else {
            console.log("HTTP request rejected for " + req.path);
            res.statusCode = 401;
            res.setHeader("WWW-Authenticate", 'Basic realm="Secure Area"');
            return res.end("<html><body>Authentication required to access this path</body></html>");
        }
    });
};


// ---------------------------------------------
// EXPORT MODULE
// ---------------------------------------------
module.exports = function (app) {
    // CORS must be first
    app.use(allowCrossDomain);

    if (process.env.NODE_ENV == "development") {
        app.use(function noCache(req, res, next) {
            if (req.url.indexOf("/scripts/") === 0) {
                res.header("Cache-Control", "no-cache, no-store, must-revalidate");
                res.header("Pragma", "no-cache");
                res.header("Expires", 0);
            }
            next();
        });
        app.use(errorHandler());
        app.locals.pretty = true;
        app.locals.compileDebug = true;
    }

    if (process.env.NODE_ENV == "production") {
        app.use(favicon(path.join(config.root, "public/app/img", "favicon.ico")));
    }

    // Basic Auth AFTER CORS
    app.use(basicHttpAuth);

    // Static / Other Middleware
    app.use('/sync_folders', function (req, res, next) {
        delete req.headers['cache-control'];
        delete req.headers['pragma'];
        fs.stat(path.join(config.syncDir, req.path), function (err, stat) {
            if (!err && stat.isDirectory()) {
                res.setHeader('Last-Modified', (new Date()).toUTCString());
            }
            next();
        });
    }, serveIndex(config.syncDir));

    app.use('/sync_folders', express.static(config.syncDir));
    app.use('/releases', express.static(config.releasesDir));
    app.use('/licenses', express.static(config.licenseDir));
    app.use('/media', express.static(path.join(config.mediaDir)));
    app.use(express.static(path.join(config.root, "public")));

    app.set("view engine", "pug");
    app.locals.basedir = config.viewDir;

    app.set("views", config.viewDir);

    app.use(bodyParser.json());
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(methodOverride());
    app.use(cookieParser());

    app.use(require("./routes"));

    app.use(function (err, req, res, next) {
        if (err.message.indexOf("not found") >= 0) return next();
        if (err.message.indexOf("Range Not Satisfiable") >= 0) return res.send();
        console.error(err.stack);
        res.status(500).render("500");
    });

    app.use(function (req, res, next) {
        res.status(404).render("404", { url: req.originalUrl });
    });
};
