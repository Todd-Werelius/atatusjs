/*
 * atatusjs
 * https://github.com/fizerkhan/atatusjs
 *
 * Copyright (c) 2013 MindscapeHQ
 * Licensed under the MIT license.
 */

(function (window, $, UAParser, undefined) {
  // pull local copy of TraceKit to handle stack trace collection
  var _traceKit = TraceKit.noConflict(),
      _atatus = window.atatus,
      _atatusApiKey,
      _userAgent = {},
      _debugMode = false,
      _allowInsecureSubmissions = false,
      _enableOfflineSave = false,
      _customData = {},
      _tags = [],
      _user,
      _version,
      _allowedDomains,
      _atatusApiUrl = 'https://www.atatus.com',
      $document;

  if ($) {
    $document = $(document);
  }

  if (UAParser) {
    _userAgent = new UAParser().getResult();
  }

  var atatus = {

    noConflict: function () {
      window.atatus = _atatus;
      return atatus;
    },

    init: function(key, options, customdata) {
      _atatusApiKey = key;
      _traceKit.remoteFetching = false;
      _customData = customdata;

      if (options) {
        _allowInsecureSubmissions = options.allowInsecureSubmissions || false;
        if (options.debugMode) {
          _debugMode = options.debugMode;
        }
      }

      sendSavedErrors();
      return atatus;
    },

    withCustomData: function (customdata) {
      _customData = customdata;
      return atatus;
    },

    withTags: function (tags) {
      _tags = tags;
    },

    attach: function () {
      if (!isApiKeyConfigured()) {
        return;
      }
      _traceKit.report.subscribe(processUnhandledException);
      if ($document) {
        $document.ajaxError(processJQueryAjaxError);
      }
      return atatus;
    },

    detach: function () {
      _traceKit.report.unsubscribe(processUnhandledException);
      if ($document) {
        $document.unbind('ajaxError', processJQueryAjaxError);
      }
      return atatus;
    },

    send: function (ex, customData, tags) {
      try {
        processUnhandledException(_traceKit.computeStackTrace(ex), {
          customData: merge(_customData, customData),
          tags: mergeArray(_tags, tags)
        });
      } catch (traceKitException) {
        if (ex !== traceKitException) {
          throw traceKitException;
        }
      }

      return atatus;
    },

    setAllowedDomains: function (domains) {
      if (Object.prototype.toString.call(domains) === '[object Array]') {
        _allowedDomains = domains;
      }
      return atatus;
    },

    setUser: function (user) {
      _user = { 'Identifier': user };
      return atatus;
    },

    setVersion: function (version) {
      _version = version;
      return atatus;
    },

    saveIfOffline: function (enableOffline) {
      if (typeof enableOffline !== 'undefined' && typeof enableOffline === 'boolean') {
        _enableOfflineSave = enableOffline;
      }

      return atatus;
    }
  };

  /* internals */

  function truncateURL(url){
      // truncate after fourth /, or 24 characters, whichever is shorter
      // /api/1/diagrams/xyz/server becomes
      // /api/1/diagrams/...
      var path = url.split('//')[1];
      var queryStart = path.indexOf('?');
      var sanitizedPath = path.toString().substring(0, queryStart);
      var truncated_parts = sanitizedPath.split('/').slice(0, 4).join('/');
      var truncated_length = sanitizedPath.substring(0, 48);
      var truncated = truncated_parts.length < truncated_length.length?
                      truncated_parts : truncated_length;
      if (truncated !== sanitizedPath) {
          truncated += '..';
      }
      return truncated;
  }

  function processJQueryAjaxError(event, jqXHR, ajaxSettings, thrownError) {
    var message = 'AJAX Error: ' +
        (jqXHR.statusText || 'unknown') +' '+
        (ajaxSettings.type || 'unknown') + ' '+
        (truncateURL(ajaxSettings.url) || 'unknown');
    atatus.send(thrownError || event.type, {
      status: jqXHR.status,
      statusText: jqXHR.statusText,
      type: ajaxSettings.type,
      url: ajaxSettings.url,
      ajaxErrorMessage: message,
      contentType: ajaxSettings.contentType,
      data: ajaxSettings.data ? ajaxSettings.data.slice(0, 10240) : undefined });
  }

  function log(message, data) {
    if (window.console && window.console.log && _debugMode) {
      window.console.log(message);

      if (data) {
        window.console.log(data);
      }
    }
  }

  function isApiKeyConfigured() {
    if (_atatusApiKey && _atatusApiKey !== '') {
      return true;
    }
    log("Atatus API key has not been configured, make sure you call atatus.init(yourApiKey)");
    return false;
  }

  function merge(o1, o2) {
    var a, o3 = {};
    for (a in o1) { o3[a] = o1[a]; }
    for (a in o2) { o3[a] = o2[a]; }
    return o3;
  }

  function mergeArray(t0, t1) {
    if (t1 != null) {
      return t0.concat(t1);
    }
    return t0;
  }

  function forEach(set, func) {
    for (var i = 0; i < set.length; i++) {
      func.call(null, i, set[i]);
    }
  }

  function isEmpty(o) {
    for (var p in o) {
      if (o.hasOwnProperty(p)) {
        return false;
      }
    }
    return true;
  }

  function getRandomInt() {
    return Math.floor(Math.random() * 9007199254740993);
  }

  function getViewPort() {
    var e = document.documentElement,
    g = document.getElementsByTagName('body')[0],
    x = window.innerWidth || e.clientWidth || g.clientWidth,
    y = window.innerHeight || e.clientHeight || g.clientHeight;
    return { width: x, height: y };
  }

  function offlineSave (data) {
    var dateTime = new Date().toJSON();

    try {
      var key = 'raygunjs=' + dateTime + '=' + getRandomInt();

      if (typeof localStorage[key] === 'undefined') {
        localStorage[key] = data;
      }
    } catch (e) {
      log('AtatusJS: LocalStorage full, cannot save exception');
    }
  }

  function sendSavedErrors() {
    for (var key in localStorage) {
      if (key.substring(0, 9) === 'raygunjs=') {
        sendToAtatus(JSON.parse(localStorage[key]));

        localStorage.removeItem(key);
      }
    }
  }

  function processUnhandledException(stackTrace, options) {
    var stack = [],
        qs = {};

    // Create stack trace array
    if (stackTrace.stack && stackTrace.stack.length) {
      forEach(stackTrace.stack, function (i, frame) {
        stack.push({
          'linenumber': frame.line || 0,
          'classname': 'line ' + frame.line + ', column ' + frame.column,
          'filename': frame.url || 'anonymous',
          'methodname': frame.func || '[anonymous]'
        });
      });
    }

    //Create search query object
    if (window.location.search && window.location.search.length > 1) {
      forEach(window.location.search.substring(1).split('&'), function (i, segment) {
        var parts = segment.split('=');
        if (parts && parts.length === 2) {
          qs[decodeURIComponent(parts[0])] = parts[1];
        }
      });
    }

    if (options === undefined) {
      options = {};
    }

    if (isEmpty(options.customData)) {
      options.customData = _customData;
    }

    if (isEmpty(options.tags)) {
      options.tags = _tags;
    }

    var screen = window.screen || { width: getViewPort().width, height: getViewPort().height, colorDepth: 8 };

    // Remove 'Uncaught ' from prefix. It happen only in Chrome, Opera
    // Firefox, Safari does not add this prefix.
    var custom_message = (options.customData && options.customData.ajaxErrorMessage) || stackTrace.message;
    if (custom_message && custom_message.indexOf('Uncaught ') === 0) {
        custom_message = stackTrace.message.substring(9);
    }

    var payload = {
      'occurred_on': new Date(),
      'details': {
        'error': {
          'classname': stackTrace.name,
          'message': custom_message || options.status || 'Script error',
          'stacktrace': stack
        },
        'environment': {
          'user_language': navigator.userLanguage,
          'document_mode': document.documentMode,
          'browser_width': getViewPort().width,
          'browser_height': getViewPort().height,
          'screen_width': screen.width,
          'screen_height': screen.height,
          'color_depth': screen.colorDepth,
          'user_agent': _userAgent,
          'url': document.location.href,
          'referrer': document.referrer,
          'host': document.domain,
          'query_string': window.location.search
        },
        'client': {
          'name': 'atatus-js',
          'version': '1.8.1'
        },
        'user_custom_data': options.customData,
        'tags': options.tags,
        'Version': _version || 'Not supplied'
      }
    };

    if (_user) {
      payload.Details.User = _user;
    }
    sendToAtatus(payload);
  }

  function sendToAtatus(data) {
    // Check for allowed domain
    if (_allowedDomains &&
        _allowedDomains.indexOf(location.host) === -1) {
        return;
    }
    // Check for API key
    if (!isApiKeyConfigured()) {
      return;
    }
    log('Sending exception data to Atatus:', data);
    var url = _atatusApiUrl + '/api/entries?apikey=' + encodeURIComponent(_atatusApiKey);
    makePostCorsRequest(url, JSON.stringify(data));
  }

  // Create the XHR object.
  function createCORSRequest(method, url) {
    var xhr;

    xhr = new window.XMLHttpRequest();
    if ("withCredentials" in xhr) {
      // XHR for Chrome/Firefox/Opera/Safari.
      xhr.open(method, url, true);

    } else if (window.XDomainRequest) {
      // XDomainRequest for IE.
      if (_allowInsecureSubmissions) {
        // remove 'https:' and use relative protocol
        // this allows IE8 to post messages when running
        // on http
        url = url.slice(6);
      }

      xhr = new window.XDomainRequest();
      xhr.open(method, url);
    }

    xhr.timeout = 10000;

    return xhr;
  }

  // Make the actual CORS request.
  function makePostCorsRequest(url, data) {
    var xhr = createCORSRequest('POST', url, data);

    if ('withCredentials' in xhr) {

      xhr.onreadystatechange = function() {
        if (xhr.readyState !== 4) {
          return;
        }

        if (xhr.status === 202) {
          sendSavedErrors();
        } else if (_enableOfflineSave && xhr.status !== 403 && xhr.status !== 400) {
          offlineSave(data);
        }
      };

      xhr.onload = function () {
        log('logged error to Atatus');
      };

    } else if (window.XDomainRequest) {
      xhr.ontimeout = function () {
        if (_enableOfflineSave) {
          log('Atatus: saved error locally');
          offlineSave(data);
        }
      };

      xhr.onload = function () {
        log('logged error to Atatus');
        sendSavedErrors();
      };
    }

    xhr.onerror = function () {
      log('failed to log error to Atatus');
    };

    if (!xhr) {
      log('CORS not supported');
      return;
    }

    xhr.send(data);
  }

  window.atatus = atatus;
})(window, window.jQuery, window.UAParser);
