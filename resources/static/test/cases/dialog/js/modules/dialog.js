/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */
(function() {
  "use strict";

  var bid = BrowserID,
      channel = bid.Channel,
      network = bid.Network,
      mediator = bid.Mediator,
      testHelpers = bid.TestHelpers,
      testErrorVisible = testHelpers.testErrorVisible,
      testErrorNotVisible = testHelpers.testErrorNotVisible,
      screens = bid.Screens,
      xhr = bid.Mocks.xhr,
      user = bid.User,
      storage = bid.Storage,
      HTTP_TEST_DOMAIN = "http://testdomain.org",
      HTTPS_TEST_DOMAIN = "https://testdomain.org",
      TESTEMAIL = "testuser@testuser.com",
      controller,
      el,
      winMock,
      navMock;

  function WinMock() {
    this.location.hash = "#1234";
  }

  WinMock.prototype = {
    // Oh so beautiful.
    opener: {
      frames: {
        1234: {
          BrowserID: {
            Relay: {
              registerClient: function() {
              },

              unregisterClient: function() {
              }
            }
          }
        }
      }
    },

    location: {
    },

    navigator: {}
  };

  function createController(config) {
    // startExternalDependencies defaults to true, for most of our tests we
    // want to turn this off to prevent the state machine, channel, and actions
    // controller from starting up and throwing errors.  This allows us to test
    // dialog as an individual unit.
    var options = $.extend({
      window: winMock,
      startExternalDependencies: false
    }, config);

    controller = BrowserID.Modules.Dialog.create();
    controller.start(options);
  }

  function testMessageNotExpected(msg) {
    mediator.subscribe(msg, function(msg, info) {
      ok(false, "unexpected message: " + msg);
    });
  }

  function testExpectGetFailure(options, expectedErrorMessage, domain) {
    _.extend(options, {
      ready: function() {
        testMessageNotExpected("kpi_data");
        testMessageNotExpected("start");

        var retval = controller.get(domain || HTTPS_TEST_DOMAIN, options);

        if (expectedErrorMessage) {
          equal(retval.message, expectedErrorMessage, "expected error: " + expectedErrorMessage);
        }
        else {
          ok(retval instanceof Error, "error message returned");
        }

        // If a parameter is not properly escaped, scriptRun will be true.
        testHelpers.testUndefined(window.scriptRun);

        testErrorVisible();
        start();
      }
    });
    createController(options);
  }

  function testRelativeURLNotAllowed(options, path) {
    testExpectGetFailure(options, "relative urls not allowed: (" + path + ")");
  }

  function testMustBeAbsolutePath(options, path) {
    testExpectGetFailure(options, "must be an absolute path: (" + path + ")");
  }

  function testExpectGetSuccess(options, expected, domain, done) {
    createController({
      ready: function() {
        var startInfo;
        mediator.subscribe("start", function(msg, info) {
          startInfo = info;
        });

        var retval = controller.get(domain || HTTPS_TEST_DOMAIN, options);
        testHelpers.testObjectValuesEqual(startInfo, expected);

        testHelpers.testUndefined(retval);
        testErrorNotVisible();

        done && done();

        start();
      }
    });
  }


  module("dialog/js/modules/dialog", {
    setup: function() {
      winMock = new WinMock();
      testHelpers.setup();
    },

    teardown: function() {
      controller.destroy();
      testHelpers.teardown();
    }
  });

  asyncTest("initialization with channel error", function() {
    // Set the hash so that the channel cannot be found.
    winMock.location.hash = "#1235";
    createController({
      startExternalDependencies: true,
      ready: function() {
        testErrorVisible();
        start();
      }
    });
  });

  asyncTest("initialization with add-on navigator.id.channel", function() {
    var registerControllerCalled = false;

    // expect registerController to be called.
    winMock.navigator.id = {
      channel : {
        registerController: function(controller) {
          registerControllerCalled = !!controller.get;
        }
      }
    };

    createController({
      startExternalDependencies: true,
      ready: function() {
        ok(registerControllerCalled, "registerController was not called with proper controller");
        start();
      }
    });
  });

  asyncTest("initialization with #NATIVE", function() {
    winMock.location.hash = "#NATIVE";

    createController({
      ready: function() {
        testErrorNotVisible();
        start();
      }
    });
  });


  asyncTest("initialization with #INTERNAL", function() {
    winMock.location.hash = "#INTERNAL";

    createController({
      ready: function() {
        testErrorNotVisible();
        start();
      }
    });
  });

  function testReturnFromIdP(verificationInfo, expectedParams) {
    storage.idpVerification.set(verificationInfo);

    createController({
      ready: function() {
        mediator.subscribe("start", function(msg, info) {
          testHelpers.testObjectValuesEqual(info, expectedParams);
          start();
        });

        try {
          controller.get(testHelpers.testOrigin, {}, function() {}, function() {});
        }
        catch(e) {
          // do nothing, an exception will be thrown because no modules are
          // registered for the any services.
        }
      }
    });
  }

  asyncTest("initialization with #AUTH_RETURN_CANCEL - " +
      " trigger start with cancelled=true", function() {
    winMock.location.hash = "#AUTH_RETURN_CANCEL";
    testReturnFromIdP({
      email: TESTEMAIL
    }, {
      cancelled: true,
      type: "primary",
      email: TESTEMAIL
    });
  });

  asyncTest("initialization with #AUTH_RETURN and add=false - trigger start with correct params", function() {
    winMock.location.hash = "#AUTH_RETURN";
    testReturnFromIdP({
      add: false,
      email: TESTEMAIL
    }, {
      type: "primary",
      email: TESTEMAIL,
      add: false,
      cancelled: false
    });
  });

  asyncTest("initialization with #AUTH_RETURN and add=true - trigger start with correct params", function() {
    winMock.location.hash = "#AUTH_RETURN";
    testReturnFromIdP({
      add: true,
      email: TESTEMAIL
    }, {
      type: "primary",
      email: TESTEMAIL,
      add: true,
      cancelled: false
    });
  });


  asyncTest("#AUTH_RETURN while authenticated should call usedAddressAsPrimary", function() {
    winMock.location.hash = "#AUTH_RETURN";
    storage.idpVerification.set({
      add: false,
      email: TESTEMAIL
    });
    xhr.setContextInfo("authenticated", true);
    xhr.setContextInfo("auth_level", "assertion");

    createController({
      ready: function() {
        mediator.subscribe("start", function(msg, info) {
          var req = xhr.getLastRequest();
          equal(req && req.url, "/wsapi/used_address_as_primary", "sent correct request");
          start();
        });

        try {
          controller.get(testHelpers.testOrigin, {}, function() {}, function() {});
        }
        catch(e) {
          // do nothing, an exception will be thrown because no modules are
          // registered for the any services.
        }
      }
    });
  });

  asyncTest("#AUTH_RETURN with add=true should not call usedAddressAsPrimary", function() {
    winMock.location.hash = "#AUTH_RETURN";
    storage.idpVerification.set({
      add: true,
      email: TESTEMAIL
    });
    xhr.setContextInfo("authenticated", true);
    xhr.setContextInfo("auth_level", "assertion");
    delete xhr.request;

    createController({
      ready: function() {
        mediator.subscribe("start", function(msg, info) {
          var req = xhr.getLastRequest();
          notEqual(req && req.url, "/wsapi/used_address_as_primary", "request should not be sent");
          start();
        });

        try {
          controller.get(testHelpers.testOrigin, {}, function() {}, function() {});
        }
        catch(e) {
          // do nothing, an exception will be thrown because no modules are
          // registered for the any services.
        }
      }
    });
  });

  asyncTest("onWindowUnload", function() {
    createController({
      ready: function() {
        var error;

        try {
          controller.onWindowUnload();
        }
        catch(e) {
          error = e;
        }

        testHelpers.testUndefined(error);
        start();
      }
    });
  });


  asyncTest("get with relative termsOfService & valid privacyPolicy - print error screen", function() {
    testRelativeURLNotAllowed({
      termsOfService: "relative.html",
      privacyPolicy: "/privacy.html"
    }, "relative.html");
  });

  asyncTest("get with script containing termsOfService - print error screen", function() {
    var URL = "relative.html<script>window.scriptRun=true;</script>";
    testRelativeURLNotAllowed({
      termsOfService: URL,
      privacyPolicy: "/privacy.html"
    }, URL);
  });

  asyncTest("get with valid termsOfService & relative privacyPolicy - print error screen", function() {
    var URL = "relative.html";
    testRelativeURLNotAllowed({
      termsOfService: "/tos.html",
      privacyPolicy: URL
    }, URL);
  });

  asyncTest("get with valid termsOfService & privacyPolicy='/' - print error screen", function() {
    var URL = "/";
    testRelativeURLNotAllowed({
      termsOfService: "/tos.html",
      privacyPolicy: URL
    }, URL);
  });

  asyncTest("get with valid termsOfService='/' and valid privacyPolicy - print error screen", function() {
    var URL = "/";
    testRelativeURLNotAllowed({
      termsOfService: URL,
      privacyPolicy: "/privacy.html"
    }, URL);
  });

  asyncTest("get with script containing privacyPolicy - print error screen", function() {
    var URL = "relative.html<script>window.scriptRun=true;</script>";
    testRelativeURLNotAllowed({
      termsOfService: "/tos.html",
      privacyPolicy: URL
    }, URL);
  });

  asyncTest("get with javascript protocol for privacyPolicy - print error screen", function() {
    var URL = "javascript:alert(1)";
    testRelativeURLNotAllowed({
      termsOfService: "/tos.html",
      privacyPolicy: URL
    }, URL);
  });

  asyncTest("get with invalid httpg protocol for privacyPolicy - print error screen", function() {
    var URL = "httpg://testdomain.com/privacy.html";
    testRelativeURLNotAllowed({
      termsOfService: "/tos.html",
      privacyPolicy: URL
    }, URL);
  });


  asyncTest("get with valid absolute termsOfService & privacyPolicy - go to start", function() {
    testExpectGetSuccess({
      termsOfService: "/tos.html",
      privacyPolicy: "/privacy.html"
    },
    {
      termsOfService: HTTPS_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTPS_TEST_DOMAIN + "/privacy.html"
    });
  });

  asyncTest("get with valid fully qualified http termsOfService & privacyPolicy - go to start", function() {
    testExpectGetSuccess({
      termsOfService: HTTP_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTP_TEST_DOMAIN + "/privacy.html"
    },
    {
      termsOfService: HTTP_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTP_TEST_DOMAIN + "/privacy.html"
    });
  });


  asyncTest("get with valid fully qualified https termsOfService & privacyPolicy - go to start", function() {
    testExpectGetSuccess({
      termsOfService: HTTPS_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTPS_TEST_DOMAIN + "/privacy.html"
    },
    {
      termsOfService: HTTPS_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTPS_TEST_DOMAIN + "/privacy.html"
    });
  });

  asyncTest("get with valid termsOfService, tosURL & privacyPolicy, privacyURL - use termsOfService and privacyPolicy", function() {
    testExpectGetSuccess({
      termsOfService: "/tos.html",
      tosURL: "/tos_deprecated.html",
      privacyPolicy: "/privacy.html",
      privacyURL: "/privacy_deprecated.html"
    },
    {
      termsOfService: HTTPS_TEST_DOMAIN + "/tos.html",
      privacyPolicy: HTTPS_TEST_DOMAIN + "/privacy.html"
    });
  });

  asyncTest("get with relative siteLogo - not allowed", function() {
    var URL = "logo.png";
    testExpectGetFailure({siteLogo: URL});
  });

  asyncTest("get with javascript: siteLogo - not allowed", function() {
    var URL = "javascript:alert('xss')";
    testExpectGetFailure({siteLogo: URL});
  });

  asyncTest("get with data:image/<whitelist>;... siteLogo - allowed", function() {
    var URL = "data:image/png;base64,FAKEDATA";
    createController({
      ready: function() {
        var siteLogo = URL
        var retval = controller.get(HTTPS_TEST_DOMAIN, {
          siteLogo: siteLogo
        });
        testHelpers.testUndefined(retval);
        testErrorNotVisible();
        start();
      }
    });
  });

  asyncTest("get with data:<not image>... siteLogo - not allowed", function() {
    var URL = "data:text/html;base64,FAKEDATA";
    testExpectGetFailure({siteLogo: URL});
  });

  asyncTest("get with http: siteLogo - not allowed", function() {
    var URL = HTTP_TEST_DOMAIN + "://logo.png";
    testExpectGetFailure({siteLogo: URL});
  });

  asyncTest("get with local https: siteLogo - allowed", function() {    
    createController({
      ready: function() {
        var siteLogo = HTTPS_TEST_DOMAIN + "://logo.png";
        var retval = controller.get(HTTPS_TEST_DOMAIN, {
          siteLogo: siteLogo
        });
        testHelpers.testUndefined(retval);
        testErrorNotVisible();
        start();
      }
    });
  });

  asyncTest("get with arbitrary domain https: siteLogo - allowed", function() {    
    createController({
      ready: function() {
        var startInfo;
        mediator.subscribe("start", function(msg, info) {
          startInfo = info;
        });

        var siteLogo = 'https://cdn.example.com/logo.png';
        var retval = controller.get(HTTPS_TEST_DOMAIN, {
          siteLogo: siteLogo
        });
        testHelpers.testObjectValuesEqual(startInfo, {
          siteLogo: siteLogo
        });
        testHelpers.testUndefined(retval);
        testErrorNotVisible();
        start();
      }
    });
  }); 

  asyncTest("get with absolute path and http RP - not allowed", function() {
    var siteLogo = '/i/card.png';
    testExpectGetFailure({ siteLogo: siteLogo }, "siteLogos can only be served from https and data schemes.", HTTP_TEST_DOMAIN);
  });

  asyncTest("get with absolute path that is too long - not allowed", function() {
    var siteLogo = '/' + testHelpers.generateString(bid.PATH_MAX_LENGTH);
    testExpectGetFailure({ siteLogo: siteLogo }, "path portion of a url must be < " + bid.PATH_MAX_LENGTH + " characters");
  });

  asyncTest("get with absolute path causing too long of a URL - not allowed", function() {
    var shortHTTPSDomain = "https://test.com";
    // create a URL that is one character too long
    var siteLogo = '/' + testHelpers.generateString(bid.URL_MAX_LENGTH - shortHTTPSDomain.length);
    testExpectGetFailure({ siteLogo: siteLogo }, "urls must be < " + bid.URL_MAX_LENGTH + " characters");
  });

  asyncTest("get with absolute path and https RP - allowed URL but is properly escaped", function() {
    createController({
      ready: function() {
        var startInfo;
        mediator.subscribe("start", function(msg, info) {
          startInfo = info;
        });

        var siteLogo = '/i/card.png" onerror="alert(\'xss\')" <script>alert(\'more xss\')</script>';
        var retval = controller.get(HTTPS_TEST_DOMAIN, {
          siteLogo: siteLogo
        });

        testHelpers.testObjectValuesEqual(startInfo, {
          siteLogo: encodeURI(HTTPS_TEST_DOMAIN + siteLogo)
        });
        testHelpers.testUndefined(retval);
        testErrorNotVisible();
        start();
      }
    });
  });

  asyncTest("get with a scheme-relative siteLogo URL and https RP - allowed", function() {
    var URL = "//example.com/image.png";
    createController({
      ready: function() {
        var startInfo;
        mediator.subscribe("start", function(msg, info) {
          startInfo = info;
        });

        var siteLogo = HTTPS_TEST_DOMAIN + "/logo.png";
        var retval = controller.get(HTTPS_TEST_DOMAIN, {
          siteLogo: siteLogo
        });

        testHelpers.testObjectValuesEqual(startInfo, {
          siteLogo: siteLogo
        });
        testHelpers.testUndefined(retval);
        testErrorNotVisible();
        start();
      }
    });
  });

  // This sort of seems like a worthy test case
  asyncTest("get with siteLogo='/' URL - not allowed", function() {
    testExpectGetFailure({ siteLogo: "/" });
  });

  asyncTest("get with fully qualified returnTo - not allowed", function() {
    var URL = HTTPS_TEST_DOMAIN + "/path";
    testMustBeAbsolutePath({ returnTo: URL }, URL);
  });

  asyncTest("get with a scheme-relative returnTo URL - not allowed", function() {
    var URL = '//example.com/return';
    testMustBeAbsolutePath({ returnTo: URL }, URL);
  });

  asyncTest("get with absolute path returnTo - allowed", function() {
    testExpectGetSuccess({ returnTo: "/path"}, {}, undefined, function() {
      equal(user.getReturnTo(),
        HTTPS_TEST_DOMAIN + "/path", "returnTo correctly set");
    });
  });

  asyncTest("get with returnTo='/' - allowed", function() {
    testExpectGetSuccess({ returnTo: "/"}, {}, undefined, function() {
      equal(user.getReturnTo(),
        HTTPS_TEST_DOMAIN + "/", "returnTo correctly set");
    });
  });

  asyncTest("experimental_forceAuthentication", function() {
    testExpectGetSuccess(
      {experimental_forceAuthentication: true},
      {forceAuthentication: true}
    );
  });

  asyncTest("experimental_forceAuthentication invalid", function() {
    testExpectGetFailure(
      {experimental_forceAuthentication: "true"});
  });

  asyncTest("get with valid issuer - allowed", function() {
    var issuer = "fxos.persona.org";
    testExpectGetSuccess(
      { experimental_forceIssuer: issuer },
      { forceIssuer: issuer }
    );
  });

  asyncTest("get with non hostname issuer - bzzzt", function() {
    var issuer = "https://issuer.must.be.a.hostname";
    testExpectGetFailure({ experimental_forceIssuer: issuer });
  });

  asyncTest("experimental_allowUnverified", function() {
    testExpectGetSuccess(
      {experimental_allowUnverified: true},
      {allowUnverified: true}
    );
  });

  asyncTest("experimental_allowUnverified invalid", function() {
    testExpectGetFailure(
      {experimental_allowUnverified: "true"});
  });

  asyncTest("get with valid rp_api - allowed", function() {
    createController({
      ready: function() {
        mediator.subscribe("kpi_data", function(msg, info) {
          equal(info.rp_api, "get");
          equal(info.orphaned, true);
          start();
        });

        controller.get(HTTPS_TEST_DOMAIN, {
          rp_api: "get"
        });
      }
    });
  });

  asyncTest("get with invalid rp_api - not allowed", function() {
    testExpectGetFailure({
      rp_api: "invalid_value"
    }, "invalid value for rp_api: invalid_value");
  });

  asyncTest("get with invalid start_time - not allowed", function() {
    testExpectGetFailure({
      start_time: "invalid_value"
    }, "invalid value for start_time: invalid_value");
  });

  asyncTest("get with numeric start_time, the numeric value of the specified date as the number of milliseconds since January 1, 1970, 00:00:00 UTC - allowed", function() {
    var now = new Date().getTime();

    createController({
      ready: function() {
        mediator.subscribe("start_time", function(msg, info) {
          equal(info, now, "correct time passed");
          start();
        });

        controller.get(HTTPS_TEST_DOMAIN, {
          start_time: now.toString()
        });
      }
    });
  });

  asyncTest("invalid backgroundColor - not allowed", function() {
    testExpectGetFailure({
      backgroundColor: "invalid_value"
    }, "invalid backgroundColor: invalid_value");
  });

  asyncTest("incorrect length (2) backgroundColor - not allowed", function() {
    testExpectGetFailure({
      backgroundColor: "ab"
    }, "invalid backgroundColor: ab");
  });

  asyncTest("incorrect length (4) backgroundColor - not allowed", function() {
    testExpectGetFailure({
      backgroundColor: "abcd"
    }, "invalid backgroundColor: abcd");
  });

  asyncTest("incorrect length (5) backgroundColor - not allowed", function() {
    testExpectGetFailure({
      backgroundColor: "abcde"
    }, "invalid backgroundColor: abcde");
  });

  asyncTest("incorrect length (7) backgroundColor - not allowed", function() {
    testExpectGetFailure({
      backgroundColor: "abcdeff"
    }, "invalid backgroundColor: abcdeff");
  });

  asyncTest("valid 3 char backgroundColor - allowed & normalized", function() {
    testExpectGetSuccess({backgroundColor: "abc"},
                         {backgroundColor: "aabbcc"});
  });

  asyncTest("valid 3 char backgroundColor with hash - allowed & normalized",
      function() {
    testExpectGetSuccess({backgroundColor: "#123"},
                         {backgroundColor: "112233"});
  });

  asyncTest("valid 6 char backgroundColor - allowed", function() {
    testExpectGetSuccess({backgroundColor: "abcdef"},
                         {backgroundColor: "abcdef"});
  });

  asyncTest("valid 6 char backgroundColor with hash - allowed", function() {
    testExpectGetSuccess({backgroundColor: "#456DEF"},
                         {backgroundColor: "456DEF"});
  });

}());

