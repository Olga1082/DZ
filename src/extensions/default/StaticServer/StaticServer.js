/*
 * Copyright (c) 2012 - present Adobe Systems Incorporated. All rights reserved.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"),
 * to deal in the Software without restriction, including without limitation
 * the rights to use, copy, modify, merge, publish, distribute, sublicense,
 * and/or sell copies of the Software, and to permit persons to whom the
 * Software is furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
 * DEALINGS IN THE SOFTWARE.
 *
 */

/*global Phoenix */

define(function (require, exports, module) {

    const BaseServer = brackets.getModule("LiveDevelopment/Servers/BaseServer").BaseServer,
        LiveDevelopmentUtils = brackets.getModule("LiveDevelopment/LiveDevelopmentUtils"),
        marked = brackets.getModule('thirdparty/marked.min'),
        DocumentManager = brackets.getModule("document/DocumentManager"),
        Mustache = brackets.getModule("thirdparty/mustache/mustache"),
        FileSystem = brackets.getModule("filesystem/FileSystem"),
        markdownHTMLTemplate = require("text!markdown.html");

    const _serverBroadcastChannel = new BroadcastChannel("virtual_server_broadcast");

    let _staticServerInstance;

    // see markdown advanced rendering options at https://marked.js.org/using_advanced
    marked.setOptions({
        renderer: new marked.Renderer(),
        pedantic: false,
        gfm: true,
        breaks: false,
        sanitize: false,
        smartLists: true,
        smartypants: false,
        xhtml: false
    });

    /**
     * @constructor
     * @extends {BaseServer}
     * Live preview server that uses a built-in HTTP server to serve static
     * and instrumented files.
     *
     * @param {!{baseUrl: string, root: string, pathResolver: function(string), nodeDomain: NodeDomain}} config
     *    Configuration parameters for this server:
     *        baseUrl        - Optional base URL (populated by the current project)
     *        pathResolver   - Function to covert absolute native paths to project relative paths
     *        root           - Native path to the project root (and base URL)
     */
    function StaticServer(config) {
        config.baseUrl = `${window.fsServerUrl}PHOENIX_LIVE_PREVIEW_${Phoenix.PHOENIX_INSTANCE_ID}`;
        this._sendInstrumentedContent = this._sendInstrumentedContent.bind(this);
        BaseServer.call(this, config);
    }

    StaticServer.prototype = Object.create(BaseServer.prototype);
    StaticServer.prototype.constructor = StaticServer;

    /**
     * Returns a URL for a given path
     * @param {string} path Absolute path to covert to a URL
     * @return {?string} Converts a path within the project root to a URL.
     *  Returns null if the path is not a descendant of the project root.
     */
    StaticServer.prototype.pathToUrl = function (path) {
        const baseUrl         = this.getBaseUrl(),
            relativePath    = this._pathResolver(path);

        // See if base url has been specified and path is within project
        if (relativePath !== path) {
            // Map to server url. Base url is already encoded, so don't encode again.

            return `${baseUrl}${encodeURI(path)}`;
        }

        return null;
    };

    /**
     * Convert a URL to a local full file path
     * @param {string} url
     * @return {?string} The absolute path for given URL or null if the path is
     *  not a descendant of the project.
     */
    StaticServer.prototype.urlToPath = function (url) {
        let path,
            baseUrl = "";

        baseUrl = this.getBaseUrl();

        if (baseUrl !== "" && url.indexOf(baseUrl) === 0) {
            // Use base url to translate to local file path.
            // Need to use encoded project path because it's decoded below.
            path = url.replace(baseUrl, "");

            return decodeURI(path);
        }

        return null;
    };

    /**
     * Determines whether we can serve local file.
     * @param {string} localPath A local path to file being served.
     * @return {boolean} true for yes, otherwise false.
     */
    StaticServer.prototype.canServe = function (localPath) {
        // If we can't transform the local path to a project relative path,
        // the path cannot be served
        if (localPath === this._pathResolver(localPath)) {
            return false;
        }

        // Url ending in "/" implies default file, which is usually index.html.
        // Return true to indicate that we can serve it.
        if (localPath.match(/\/$/)) {
            return true;
        }

        // FUTURE: do a MIME Type lookup on file extension
        return LiveDevelopmentUtils.isStaticHtmlFileExt(localPath);
    };

    /**
     * @private
     * Update the list of paths that fire "request" events
     * @return {jQuery.Promise} Resolved by the StaticServer domain when the message is acknowledged.
     */
    StaticServer.prototype._updateInstrumentedURLSInWorker = function () {
        let paths = Object.keys(this._liveDocuments)
            .concat(Object.keys(this._virtualServingDocuments));
        console.log(`Static server _updateInstrumentedURLSInWorker: `, this._root, paths);

        window.messageSW({
            type: 'setInstrumentedURLs',
            root: this._root,
            paths
        }).then((status)=>{
            console.log(`Static server received msg from Service worker: setInstrumentedURLs done: `, status);
        }).catch(err=>{
            console.error("Static server received msg from Service worker: Error while setInstrumentedURLs", err);
        });
    };

    /**
     * Gets the server details from the StaticServerDomain in node.
     * The domain itself handles starting a server if necessary (when
     * the staticServer.getServer command is called).
     *
     * @return {jQuery.Promise} A promise that resolves/rejects when
     *     the server is ready/failed.
     */
    StaticServer.prototype.readyToServe = function () {
        return $.Deferred().resolve().promise(); // virtual server is always assumed present in phoenix
    };

    /**
     * This will add the given text to be served when the path is hit in server. use this to either serve a file
     * that doesn't exist in project, or to override a given path to the contents you give.
     */
    StaticServer.prototype.addVirtualContentAtPath = function (path, docText) {
        BaseServer.prototype.addVirtualContentAtPath.call(this, path, docText);

        // update the paths to watch
        this._updateInstrumentedURLSInWorker();
    };

    /**
     * See BaseServer#add. StaticServer ignores documents that do not have
     * a setInstrumentationEnabled method. Updates request filters.
     */
    StaticServer.prototype.add = function (liveDocument) {
        if (liveDocument.setInstrumentationEnabled) {
            // enable instrumentation
            liveDocument.setInstrumentationEnabled(true);
        }

        BaseServer.prototype.add.call(this, liveDocument);

        // update the paths to watch
        this._updateInstrumentedURLSInWorker();
    };

    /**
     * See BaseServer#remove. Updates request filters.
     */
    StaticServer.prototype.remove = function (liveDocument) {
        BaseServer.prototype.remove.call(this, liveDocument);

        this._updateInstrumentedURLSInWorker();
    };

    /**
     * removes path added by addVirtualContentAtPath()
     */
    StaticServer.prototype.removeVirtualContentAtPath = function (path) {
        BaseServer.prototype.removeVirtualContentAtPath.call(this, path);

        // update the paths to watch
        this._updateInstrumentedURLSInWorker();
    };

    /**
     * See BaseServer#clear. Updates request filters.
     */
    StaticServer.prototype.clear = function () {
        BaseServer.prototype.clear.call(this);

        this._updateInstrumentedURLSInWorker();
    };

    /**
     * @private
     * Send HTTP response data back to the StaticServerSomain
     */
    StaticServer.prototype._send = function (location, response) {
        this._nodeDomain.exec("writeFilteredResponse", location.root, location.pathname, response);
    };

    function _sendMarkdown(fullPath, requestID) {
        DocumentManager.getDocumentForPath(fullPath)
            .done(function (doc) {
                let text = doc.getText();
                let markdownHtml = marked.parse(text);
                let templateVars = {
                    markdownContent: markdownHtml,
                    BOOTSTRAP_LIB_CSS: `${window.parent.Phoenix.baseURL}thirdparty/bootstrap/bootstrap.min.css`,
                    HIGHLIGHT_JS_CSS: `${window.parent.Phoenix.baseURL}thirdparty/highlight.js/styles/github.min.css`,
                    HIGHLIGHT_JS: `${window.parent.Phoenix.baseURL}thirdparty/highlight.js/highlight.min.js`,
                    GFM_CSS: `${window.parent.Phoenix.baseURL}thirdparty/gfm.min.css`
                };
                let html = Mustache.render(markdownHTMLTemplate, templateVars);
                _serverBroadcastChannel.postMessage({
                    type: 'REQUEST_RESPONSE',
                    requestID, //pass along the requestID to call the appropriate callback at service worker
                    fullPath,
                    contents: html,
                    headers: {'Content-Type': 'text/html'}
                });
            })
            .fail(function (err) {
                console.error(`Markdown rendering failed for ${fullPath}: `, err);
            });
    }

    function _getExtension(filePath) {
        filePath = filePath || '';
        let pathSplit = filePath.split('.');
        return pathSplit && pathSplit.length>1 ? pathSplit[pathSplit.length-1] : '';
    }

    function _isMarkdownFile(filePath) {
        let extension = _getExtension(filePath);
        return ['md', 'markdown'].includes(extension.toLowerCase());
    }

    /**
     * @private
     * Events raised by broadcast channel from the service worker will be captured here. The service worker will ask
     * all phoenix instances if the url to be served should be replaced with instrumented content here or served
     * as static file from disk.
     * @param {{hostname: string, pathname: string, port: number, root: string, id: number}} request
     */
    StaticServer.prototype._sendInstrumentedContent = function (data) {
        if(data.phoenixInstanceID && data.phoenixInstanceID !== Phoenix.PHOENIX_INSTANCE_ID) {
            return;
        }
        let path = this._documentKey(data.path),
            requestID = data.requestID,
            liveDocument = this._liveDocuments[path],
            virtualDocument = this._virtualServingDocuments[path];
        let response;

        if (virtualDocument) {
            // virtual document overrides takes precedence over live preview docs
            response = {
                body: virtualDocument
            };
        } else if (liveDocument && liveDocument.getResponseData) {
            response = liveDocument.getResponseData();
        } else {
            const file = FileSystem.getFileForPath(data.path);
            let docTextToSend = "instrumented document not found at static server";
            DocumentManager.getDocumentText(file).done(function (docText) {
                docTextToSend = docText;
            }).always(function () {
                _serverBroadcastChannel.postMessage({
                    type: 'REQUEST_RESPONSE',
                    requestID, //pass along the requestID
                    path,
                    contents: docTextToSend
                });
            });
            return;
        }

        _serverBroadcastChannel.postMessage({
            type: 'REQUEST_RESPONSE',
            requestID, //pass along the requestID so that the appropriate callback will be hit at the service worker
            path,
            contents: response.body
        });
    };

    _serverBroadcastChannel.onmessage = (event) => {
        window.logger.livePreview.log("Static server: ", event.data, Phoenix.PHOENIX_INSTANCE_ID);
        if (event.data.type === "getInstrumentedContent"
            && event.data.phoenixInstanceID === Phoenix.PHOENIX_INSTANCE_ID) {
            // localStorage is domain specific so when it changes in one window it changes in the other
            if(_isMarkdownFile(event.data.path)){
                _sendMarkdown(event.data.path, event.data.requestID);
                return;
            }
            if(_staticServerInstance){
                _staticServerInstance._sendInstrumentedContent(event.data);
            }
        }
    };

    /**
     * See BaseServer#start. Starts listenting to StaticServerDomain events.
     */
    StaticServer.prototype.start = function () {
        _staticServerInstance = this;
    };

    /**
     * See BaseServer#stop. Remove event handlers from StaticServerDomain.
     */
    StaticServer.prototype.stop = function () {
        _staticServerInstance = undefined;
    };

    module.exports = StaticServer;
});
