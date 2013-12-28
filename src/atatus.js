/*
 * atatusjs
 * https://github.com/fizerkhan/atatusjs
 *
 * Copyright (c) 2013 MindscapeHQ
 * Licensed under the MIT license.
 */

(function (window, $, UAParser) {
  // pull local copy of TraceKit to handle stack trace collection
  var _traceKit = TraceKit.noConflict(),
      _atatus = window.atatus,
      _atatusApiKey,
      _debugMode = false,
      _customData = {},
      _userAgent = {},
      _user,
      _version,
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

      if (options)
      {
        if (options.debugMode)
        {
          _debugMode = options.debugMode;
        }
      }

      return atatus;
    },

    withCustomData: function (customdata) {
      _customData = customdata;
      return atatus;
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

    send: function (ex, customData) {
      try {
        processUnhandledException(_traceKit.computeStackTrace(ex), merge(_customData, customData));
      }
      catch (traceKitException) {
        if (ex !== traceKitException) {
          throw traceKitException;
        }
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

    track: function(name, properties) {
      if (!name) {
        return;
      }
      processTrack(name, properties);
    }

    // trackLink: function(links, name, properties) {
    //   if (!name) {
    //     return;
    //   }
    //   processTrack(name, properties);
    // },

    // trackForm: function(forms, name, properties) {
    //   if (!name) {
    //     return;
    //   }
    //   processTrack(name, properties);
    // },
  };

  /* internals */

  function processJQueryAjaxError(event, jqXHR, ajaxSettings, thrownError) {
    atatus.send(thrownError || event.type, {
      status: jqXHR.status,
      statusText: jqXHR.statusText,
      type: ajaxSettings.type,
      url: ajaxSettings.url,
      contentType: ajaxSettings.contentType });
  }

  function log(message) {
    if (window.console && window.console.log && _debugMode) {
      window.console.log(message);
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

  function getViewPort() {
    var e = document.documentElement,
    g = document.getElementsByTagName('body')[0],
    x = window.innerWidth || e.clientWidth || g.clientWidth,
    y = window.innerHeight || e.clientHeight || g.clientHeight;
    return { width: x, height: y };
  }

  function processUnhandledException(stackTrace, options) {
    var stack = [],
        message = 'Script error';

    // Create stack trace array
    if (stackTrace.stack && stackTrace.stack.length) {
      forEach(stackTrace.stack, function (i, frame) {
        stack.push({
          'linenumber': frame.line,
          'classname': 'line ' + frame.line + ', column ' + frame.column,
          'filename': frame.url,
          'methodname': frame.func || '[anonymous]'
        });
      });
    }

    // Create search query object
    // var qs = {};
    // if (window.location.search && window.location.search.length > 1) {
    //   forEach(window.location.search.substring(1).split('&'), function (i, segment) {
    //     var parts = segment.split('=');
    //     if (parts && parts.length === 2) {
    //       qs[decodeURIComponent(parts[0])] = parts[1];
    //     }
    //   });
    // }

    // Remove 'Uncaught ' from prefix. It happen only in Chrome, Opera
    // Firefox, Safari does not add this prefix.
    if (stackTrace.message && stackTrace.message.indexOf('Uncaught ') === 0) {
        message = stackTrace.message.substring(9);
    }

    if (isEmpty(options)) {
      options = _customData;
    }

    var screen = window.screen || { width: getViewPort().width, height: getViewPort().height, colorDepth: 8 };

    var payload = {
      'occurred_on': new Date(),
      'details': {
        'error': {
          'classname': stackTrace.name,
          'message': message,
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
          'version': '1.2.1'
        },
        'user_custom_data': options,
        'version': _version || 'Not supplied'
      }
    };

    if (_user) {
      payload.details.user = _user;
    }
    sendToAtatus(payload, 'exception');
  }

  function processTrack(name, properties) {
    var payload = {
      'event': name,
      'properties': properties,
      '$properties': {
        'browser': window.navigator.userAgent,
        'referrer': document.referrer,
        'host': document.domain
      }
    };
    sendToAtatus(payload, 'log');
  }

  function sendToAtatus(data, type) {
    if (!isApiKeyConfigured()) {
      return;
    }
    log('Sending data to Atatus:', data);
    var url = 'http://www.atatus.com/api/entries/' + type + '?apikey=' + encodeURIComponent(_atatusApiKey);
    makeCorsRequest(url, JSON.stringify(data));
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
      xhr = new window.XDomainRequest();
      xhr.open(method, url);
    }

    xhr.onload = function () {
      log('logged error to Atatus');
    };
    xhr.onerror = function () {
      log('failed to log error to Atatus');
    };

    return xhr;
  }

  // Make the actual CORS request.
  function makeCorsRequest(url, data) {
    var xhr = createCORSRequest('POST', url);
    if (!xhr) {
      log('CORS not supported');
      return;
    }

    xhr.send(data);
  }

  window.atatus = atatus;
})(window, window.jQuery, window.UAParser);
