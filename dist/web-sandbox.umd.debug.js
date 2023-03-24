(function (global, factory) {
  typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
  typeof define === 'function' && define.amd ? define(['exports'], factory) :
  (global = typeof globalThis !== 'undefined' ? globalThis : global || self, factory(global.HTMLWebSandboxElement = {}));
}(this, (function (exports) { 'use strict';

  // we'd like to abandon, but we can't, so just scream and break a lot of
  // stuff. However, since we aren't really aborting the process, be careful to
  // not throw an Error object which could be captured by child-Realm code and
  // used to access the (too-powerful) primal-realm Error object.

  function throwTantrum(s, err = undefined) {
    const msg = `please report internal shim error: ${s}`;

    // we want to log these 'should never happen' things.
    // eslint-disable-next-line no-console
    console.error(msg);
    if (err) {
      // eslint-disable-next-line no-console
      console.error(`${err}`);
      // eslint-disable-next-line no-console
      console.error(`${err.stack}`);
    }

    // eslint-disable-next-line no-debugger
    debugger;
    throw msg;
  }

  function assert(condition, message) {
    if (!condition) {
      throwTantrum(message);
    }
  }

  /**
   * safeStringifyFunction()
   * Remove code modifications introduced by ems and nyx in
   * test mode which intefere with Function.toString().
   */
  function safeStringifyFunction(fn) {
    let src = `'use strict'; (${fn})`;

    // esm module creates "runtime" as "_" + hex(3) + "\u200D"

    // Restore eval which is modified by esm module.
    // (0, eval) => (0, <runtime>.e)
    src = src.replace(/\(0,\s*_[0-9a-fA-F]{3}\u200D\.e\)/g, '(0, eval)');

    // Restore globals such as Reflect which are modified by esm module.
    // Reflect => <runtime>.e.Reflect
    src = src.replace(/_[0-9a-fA-F]{3}\u200D\.g\./g, '');

    // Remove code coverage which is injected by nyc module.
    src = src.replace(/cov_[^+]+\+\+[;,]/g, '');

    return src;
  }

  // buildChildRealm is immediately turned into a string, and this function is
  // never referenced again, because it closes over the wrong intrinsics

  function buildChildRealm(unsafeRec, BaseRealm) {
    const { callAndWrapError } = unsafeRec;
    const {
      initRootRealm,
      initCompartment,
      getRealmGlobal,
      realmEvaluate
    } = BaseRealm;

    const { create, defineProperties } = Object;

    class Realm {
      constructor() {
        // The Realm constructor is not intended to be used with the new operator
        // or to be subclassed. It may be used as the value of an extends clause
        // of a class definition but a super call to the Realm constructor will
        // cause an exception.

        // When Realm is called as a function, an exception is also raised because
        // a class constructor cannot be invoked without 'new'.
        throw new TypeError('Realm is not a constructor');
      }

      static makeRootRealm(options = {}) {
        // This is the exposed interface.

        // Bypass the constructor.
        const r = create(Realm.prototype);
        callAndWrapError(initRootRealm, [unsafeRec, r, options]);
        return r;
      }

      static makeCompartment(options = {}) {
        // Bypass the constructor.
        const r = create(Realm.prototype);
        callAndWrapError(initCompartment, [unsafeRec, r, options]);
        return r;
      }

      // we omit the constructor because it is empty. All the personalization
      // takes place in one of the two static methods,
      // makeRootRealm/makeCompartment

      get global() {
        // this is safe against being called with strange 'this' because
        // baseGetGlobal immediately does a trademark check (it fails unless
        // this 'this' is present in a weakmap that is only populated with
        // legitimate Realm instances)
        return callAndWrapError(getRealmGlobal, [this]);
      }

      evaluate(x, endowments, options = {}) {
        // safe against strange 'this', as above
        return callAndWrapError(realmEvaluate, [this, x, endowments, options]);
      }
    }

    defineProperties(Realm, {
      toString: {
        value: () => 'function Realm() { [shim code] }',
        writable: false,
        enumerable: false,
        configurable: true
      }
    });

    defineProperties(Realm.prototype, {
      toString: {
        value: () => '[object Realm]',
        writable: false,
        enumerable: false,
        configurable: true
      }
    });

    return Realm;
  }

  // The parentheses means we don't bind the 'buildChildRealm' name inside the
  // child's namespace. this would accept an anonymous function declaration.
  // function expression (not a declaration) so it has a completion value.
  const buildChildRealmString = safeStringifyFunction(buildChildRealm);

  function buildCallAndWrapError() {
    // This Object and Reflect are brand new, from a new unsafeRec, so no user
    // code has been run or had a chance to manipulate them. Don't ever run this
    // function *after* user code has had a chance to pollute its environment,
    // or it could be used to gain access to BaseRealm and primal-realm Error
    // objects.
    const { getPrototypeOf } = Object;
    const { apply } = Reflect;
    const uncurryThis = fn => (thisArg, ...args) => apply(fn, thisArg, args);
    const mapGet = uncurryThis(Map.prototype.get);
    const setHas = uncurryThis(Set.prototype.has);

    const errorNameToErrorConstructor = new Map([
      ['EvalError', EvalError],
      ['RangeError', RangeError],
      ['ReferenceError', ReferenceError],
      ['SyntaxError', SyntaxError],
      ['TypeError', TypeError],
      ['URIError', URIError]
    ]);
    const errorConstructors = new Set([
      EvalError.prototype,
      RangeError.prototype,
      ReferenceError.prototype,
      SyntaxError.prototype,
      TypeError.prototype,
      URIError.prototype,
      Error.prototype
    ]);

    function callAndWrapError(target, args) {
      try {
        return apply(target, undefined, args);
      } catch (err) {
        // 1. Thrown primitives
        if (Object(err) !== err) {
          // err is a primitive value, which is safe to rethrow
          throw err;
        }

        // 2. Current realm errors
        if (setHas(errorConstructors, getPrototypeOf(err))) {
          // err is a from the current realm, which is safe to rethrow.
          // Object instances (normally) only contain intrinsics from the
          // same realm. An error containing intrinsics from different
          // realms would have to be manually constucted, which imply that
          // such intrinsics were available, and confinement was already lost.
          throw err;
        }

        // 3. Other realm errors
        let eName, eMessage, eStack;
        try {
          // The other environment might seek to use 'err' to reach the
          // parent's intrinsics and corrupt them. In addition, exceptions
          // raised in the primal realm need to be converted to the current
          // realm.

          // `${err.name}` will cause string coercion of 'err.name'.
          // If err.name is an object (probably a String of another Realm),
          // the coercion uses err.name.toString(), which is under the control
          // of the other realm. If err.name were a primitive (e.g. a number),
          // it would use Number.toString(err.name), using the child's version
          // of Number (which the child could modify to capture its argument for
          // later use), however primitives don't have properties like .prototype
          // so they aren't useful for an attack.
          eName = `${err.name}`;
          eMessage = `${err.message}`;
          eStack = `${err.stack || eMessage}`;
          // eName/eMessage/eStack are now realm-independent primitive strings, and
          // safe to expose.
        } catch (ignored) {
          // if err.name.toString() throws, keep the (parent realm) Error away.
          throw new Error('unknown error');
        }
        const ErrorConstructor =
          mapGet(errorNameToErrorConstructor, eName) || Error;
        try {
          throw new ErrorConstructor(eMessage);
        } catch (err2) {
          err2.stack = eStack; // replace with the captured inner stack
          throw err2;
        }
      }
    }

    return callAndWrapError;
  }

  const buildCallAndWrapErrorString = safeStringifyFunction(
    buildCallAndWrapError
  );

  // Declare shorthand functions. Sharing these declarations across modules
  // improves both consistency and minification. Unused declarations are
  // dropped by the tree shaking process.

  // we capture these, not just for brevity, but for security. If any code
  // modifies Object to change what 'assign' points to, the Realm shim would be
  // corrupted.

  const {
    assign,
    create,
    freeze,
    defineProperties, // Object.defineProperty is allowed to fail
    // silentlty, use Object.defineProperties instead.
    getOwnPropertyDescriptor,
    getOwnPropertyDescriptors,
    getOwnPropertyNames,
    getPrototypeOf,
    setPrototypeOf
  } = Object;

  const {
    apply,
    ownKeys // Reflect.ownKeys includes Symbols and unenumerables,
    // unlike Object.keys()
  } = Reflect;

  /**
   * uncurryThis() See
   * http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
   * which only lives at
   * http://web.archive.org/web/20160805225710/http://wiki.ecmascript.org/doku.php?id=conventions:safe_meta_programming
   *
   * Performance:
   * 1. The native call is about 10x faster on FF than chrome
   * 2. The version using Function.bind() is about 100x slower on FF,
   *    equal on chrome, 2x slower on Safari
   * 3. The version using a spread and Reflect.apply() is about 10x
   *    slower on FF, equal on chrome, 2x slower on Safari
   *
   * const bind = Function.prototype.bind;
   * const uncurryThis = bind.bind(bind.call);
   */
  const uncurryThis = fn => (thisArg, ...args) => apply(fn, thisArg, args);

  // We also capture these for security: changes to Array.prototype after the
  // Realm shim runs shouldn't affect subsequent Realm operations.
  const objectHasOwnProperty = uncurryThis(
      Object.prototype.hasOwnProperty
    ),
    arrayFilter = uncurryThis(Array.prototype.filter),
    arrayPop = uncurryThis(Array.prototype.pop),
    arrayJoin = uncurryThis(Array.prototype.join),
    arrayConcat = uncurryThis(Array.prototype.concat),
    regexpTest = uncurryThis(RegExp.prototype.test),
    stringIncludes = uncurryThis(String.prototype.includes);

  // These value properties of the global object are non-writable,
  // non-configurable data properties.
  const frozenGlobalPropertyNames = [
    // *** 18.1 Value Properties of the Global Object

    'Infinity',
    'NaN',
    'undefined'
  ];

  // All the following stdlib items have the same name on both our intrinsics
  // object and on the global object. Unlike Infinity/NaN/undefined, these
  // should all be writable and configurable. This is divided into two
  // sets. The stable ones are those the shim can freeze early because
  // we don't expect anyone will want to mutate them. The unstable ones
  // are the ones that we correctly initialize to writable and
  // configurable so that they can still be replaced or removed.
  const stableGlobalPropertyNames = [
    // *** 18.2 Function Properties of the Global Object

    // 'eval', // comes from safeEval instead
    'isFinite',
    'isNaN',
    'parseFloat',
    'parseInt',

    'decodeURI',
    'decodeURIComponent',
    'encodeURI',
    'encodeURIComponent',

    // *** 18.3 Constructor Properties of the Global Object

    'Array',
    'ArrayBuffer',
    'Boolean',
    'DataView',
    // 'Date',  // Unstable
    // 'Error',  // Unstable
    'EvalError',
    'Float32Array',
    'Float64Array',
    // 'Function',  // comes from safeFunction instead
    'Int8Array',
    'Int16Array',
    'Int32Array',
    'Map',
    'Number',
    'Object',
    // 'Promise',  // Unstable
    // 'Proxy',  // Unstable
    'RangeError',
    'ReferenceError',
    // 'RegExp',  // Unstable
    'Set',
    // 'SharedArrayBuffer'  // removed on Jan 5, 2018
    'String',
    'Symbol',
    'SyntaxError',
    'TypeError',
    'Uint8Array',
    'Uint8ClampedArray',
    'Uint16Array',
    'Uint32Array',
    'URIError',
    'WeakMap',
    'WeakSet',

    // *** 18.4 Other Properties of the Global Object

    // 'Atomics', // removed on Jan 5, 2018
    'JSON',
    'Math',
    'Reflect',

    // *** Annex B

    'escape',
    'unescape'

    // *** ECMA-402

    // 'Intl'  // Unstable

    // *** ESNext

    // 'Realm' // Comes from createRealmGlobalObject()
  ];

  const unstableGlobalPropertyNames = [
    'Date',
    'Error',
    'Promise',
    'Proxy',
    'RegExp',
    'Intl'
  ];

  function getSharedGlobalDescs(
    unsafeGlobal,
    configurableGlobals = false
  ) {
    const descriptors = {};

    function describe(names, writable, enumerable, configurable) {
      for (const name of names) {
        const desc = getOwnPropertyDescriptor(unsafeGlobal, name);
        if (desc) {
          // Abort if an accessor is found on the unsafe global object
          // instead of a data property. We should never get into this
          // non standard situation.
          assert(
            'value' in desc,
            `unexpected accessor on global property: ${name}`
          );

          descriptors[name] = {
            value: desc.value,
            writable,
            enumerable,
            configurable
          };
        }
      }
    }

    if (configurableGlobals) {
      describe(frozenGlobalPropertyNames, true, false, true);
      // The following is correct but expensive.
      describe(stableGlobalPropertyNames, true, false, true);
    } else {
      // Instead, for now, we let these get optimized.
      describe(frozenGlobalPropertyNames, false, false, false);
      describe(stableGlobalPropertyNames, false, false, false);
    }
    // These we keep replaceable and removable, because we expect
    // others, e.g., SES, may want to do so.
    describe(unstableGlobalPropertyNames, true, false, true);

    return descriptors;
  }

  // Adapted from SES/Caja - Copyright (C) 2011 Google Inc.
  // https://github.com/google/caja/blob/master/src/com/google/caja/ses/startSES.js
  // https://github.com/google/caja/blob/master/src/com/google/caja/ses/repairES5.js

  /**
   * Replace the legacy accessors of Object to comply with strict mode
   * and ES2016 semantics, we do this by redefining them while in 'use strict'.
   *
   * todo: list the issues resolved
   *
   * This function can be used in two ways: (1) invoked directly to fix the primal
   * realm's Object.prototype, and (2) converted to a string to be executed
   * inside each new RootRealm to fix their Object.prototypes. Evaluation requires
   * the function to have no dependencies, so don't import anything from
   * the outside.
   */

  // todo: this file should be moved out to a separate repo and npm module.
  function repairAccessors() {
    const {
      defineProperty,
      defineProperties,
      getOwnPropertyDescriptor,
      getPrototypeOf,
      prototype: objectPrototype
    } = Object;

    // On some platforms, the implementation of these functions act as
    // if they are in sloppy mode: if they're invoked badly, they will
    // expose the global object, so we need to repair these for
    // security. Thus it is our responsibility to fix this, and we need
    // to include repairAccessors. E.g. Chrome in 2016.

    try {
      // Verify that the method is not callable.
      // eslint-disable-next-line no-restricted-properties, no-underscore-dangle
      (0, objectPrototype.__lookupGetter__)('x');
    } catch (ignore) {
      // Throws, no need to patch.
      return;
    }

    function toObject(obj) {
      if (obj === undefined || obj === null) {
        throw new TypeError(`can't convert undefined or null to object`);
      }
      return Object(obj);
    }

    function asPropertyName(obj) {
      if (typeof obj === 'symbol') {
        return obj;
      }
      return `${obj}`;
    }

    function aFunction(obj, accessor) {
      if (typeof obj !== 'function') {
        throw TypeError(`invalid ${accessor} usage`);
      }
      return obj;
    }

    defineProperties(objectPrototype, {
      __defineGetter__: {
        value: function __defineGetter__(prop, func) {
          const O = toObject(this);
          defineProperty(O, prop, {
            get: aFunction(func, 'getter'),
            enumerable: true,
            configurable: true
          });
        }
      },
      __defineSetter__: {
        value: function __defineSetter__(prop, func) {
          const O = toObject(this);
          defineProperty(O, prop, {
            set: aFunction(func, 'setter'),
            enumerable: true,
            configurable: true
          });
        }
      },
      __lookupGetter__: {
        value: function __lookupGetter__(prop) {
          let O = toObject(this);
          prop = asPropertyName(prop);
          let desc;
          while (O && !(desc = getOwnPropertyDescriptor(O, prop))) {
            O = getPrototypeOf(O);
          }
          return desc && desc.get;
        }
      },
      __lookupSetter__: {
        value: function __lookupSetter__(prop) {
          let O = toObject(this);
          prop = asPropertyName(prop);
          let desc;
          while (O && !(desc = getOwnPropertyDescriptor(O, prop))) {
            O = getPrototypeOf(O);
          }
          return desc && desc.set;
        }
      }
    });
  }

  // Adapted from SES/Caja
  // Copyright (C) 2011 Google Inc.
  // https://github.com/google/caja/blob/master/src/com/google/caja/ses/startSES.js
  // https://github.com/google/caja/blob/master/src/com/google/caja/ses/repairES5.js

  /**
   * This block replaces the original Function constructor, and the original
   * %GeneratorFunction% %AsyncFunction% and %AsyncGeneratorFunction%, with
   * safe replacements that throw if invoked.
   *
   * These are all reachable via syntax, so it isn't sufficient to just
   * replace global properties with safe versions. Our main goal is to prevent
   * access to the Function constructor through these starting points.

   * After this block is done, the originals must no longer be reachable, unless
   * a copy has been made, and funtions can only be created by syntax (using eval)
   * or by invoking a previously saved reference to the originals.
   */

  // todo: this file should be moved out to a separate repo and npm module.
  function repairFunctions() {
    const { defineProperties, getPrototypeOf, setPrototypeOf } = Object;

    /**
     * The process to repair constructors:
     * 1. Create an instance of the function by evaluating syntax
     * 2. Obtain the prototype from the instance
     * 3. Create a substitute tamed constructor
     * 4. Replace the original constructor with the tamed constructor
     * 5. Replace tamed constructor prototype property with the original one
     * 6. Replace its [[Prototype]] slot with the tamed constructor of Function
     */
    function repairFunction(name, declaration) {
      let FunctionInstance;
      try {
        // eslint-disable-next-line no-new-func
        FunctionInstance = (0, eval)(declaration);
      } catch (e) {
        if (e instanceof SyntaxError) {
          // Prevent failure on platforms where async and/or generators
          // are not supported.
          return;
        }
        // Re-throw
        throw e;
      }
      const FunctionPrototype = getPrototypeOf(FunctionInstance);

      // Prevents the evaluation of source when calling constructor on the
      // prototype of functions.
      const TamedFunction = function() {
        throw new TypeError('Not available');
      };
      defineProperties(TamedFunction, { name: { value: name } });

      // (new Error()).constructors does not inherit from Function, because Error
      // was defined before ES6 classes. So we don't need to repair it too.

      // (Error()).constructor inherit from Function, which gets a tamed
      // constructor here.

      // todo: in an ES6 class that does not inherit from anything, what does its
      // constructor inherit from? We worry that it inherits from Function, in
      // which case instances could give access to unsafeFunction. markm says
      // we're fine: the constructor inherits from Object.prototype

      // This line replaces the original constructor in the prototype chain
      // with the tamed one. No copy of the original is peserved.
      defineProperties(FunctionPrototype, {
        constructor: { value: TamedFunction }
      });

      // This line sets the tamed constructor's prototype data property to
      // the original one.
      defineProperties(TamedFunction, {
        prototype: { value: FunctionPrototype }
      });

      if (TamedFunction !== Function.prototype.constructor) {
        // Ensures that all functions meet "instanceof Function" in a realm.
        setPrototypeOf(TamedFunction, Function.prototype.constructor);
      }
    }

    // Here, the order of operation is important: Function needs to be repaired
    // first since the other repaired constructors need to inherit from the tamed
    // Function function constructor.

    // note: this really wants to be part of the standard, because new
    // constructors may be added in the future, reachable from syntax, and this
    // list must be updated to match.

    // "plain arrow functions" inherit from Function.prototype

    repairFunction('Function', '(function(){})');
    repairFunction('GeneratorFunction', '(function*(){})');
    repairFunction('AsyncFunction', '(async function(){})');
    repairFunction('AsyncGeneratorFunction', '(async function*(){})');
  }

  // this module must never be importable outside the Realm shim itself

  // A "context" is a fresh unsafe Realm as given to us by existing platforms.
  // We need this to implement the shim. However, when Realms land for real,
  // this feature will be provided by the underlying engine instead.

  // note: in a node module, the top-level 'this' is not the global object
  // (it's *something* but we aren't sure what), however an indirect eval of
  // 'this' will be the correct global object.

  const unsafeGlobalSrc = "'use strict'; this";
  const unsafeGlobalEvalSrc = `(0, eval)("'use strict'; this")`;

  // This method is only exported for testing purposes.
  function createNewUnsafeGlobalForNode() {
    // Note that webpack and others will shim 'vm' including the method
    // 'runInNewContext', so the presence of vm is not a useful check

    // TODO: Find a better test that works with bundlers
    // eslint-disable-next-line no-new-func
    const isNode = new Function(
      'try {return this===global}catch(e){return false}'
    )();

    if (!isNode) {
      return undefined;
    }

    // eslint-disable-next-line global-require
    const vm = require('vm');

    // Use unsafeGlobalEvalSrc to ensure we get the right 'this'.
    const unsafeGlobal = vm.runInNewContext(unsafeGlobalEvalSrc);

    return unsafeGlobal;
  }

  // This method is only exported for testing purposes.
  function createNewUnsafeGlobalForBrowser() {
    if (typeof document === 'undefined') {
      return undefined;
    }
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';

    document.body.appendChild(iframe);
    const unsafeGlobal = iframe.contentWindow.eval(unsafeGlobalSrc);

    // We keep the iframe attached to the DOM because removing it
    // causes its global object to lose intrinsics, its eval()
    // function to evaluate code, etc.

    // TODO: can we remove and garbage-collect the iframes?

    return unsafeGlobal;
  }

  const getNewUnsafeGlobal = () => {
    const newUnsafeGlobalForBrowser = createNewUnsafeGlobalForBrowser();
    const newUnsafeGlobalForNode = createNewUnsafeGlobalForNode();
    if (
      (!newUnsafeGlobalForBrowser && !newUnsafeGlobalForNode) ||
      (newUnsafeGlobalForBrowser && newUnsafeGlobalForNode)
    ) {
      throw new Error('unexpected platform, unable to create Realm');
    }
    return newUnsafeGlobalForBrowser || newUnsafeGlobalForNode;
  };

  // The unsafeRec is shim-specific. It acts as the mechanism to obtain a fresh
  // set of intrinsics together with their associated eval and Function
  // evaluators. These must be used as a matched set, since the evaluators are
  // tied to a set of intrinsics, aka the "undeniables". If it were possible to
  // mix-and-match them from different contexts, that would enable some
  // attacks.
  function createUnsafeRec(
    unsafeGlobal,
    allShims = [],
    configurableGlobals = false
  ) {
    const sharedGlobalDescs = getSharedGlobalDescs(
      unsafeGlobal,
      configurableGlobals
    );

    const unsafeEval = unsafeGlobal.eval;
    const unsafeFunction = unsafeGlobal.Function;
    const callAndWrapError = unsafeEval(buildCallAndWrapErrorString)();

    return freeze({
      unsafeGlobal,
      sharedGlobalDescs,
      unsafeEval,
      unsafeFunction,
      callAndWrapError,
      allShims
    });
  }

  const repairAccessorsString = safeStringifyFunction(repairAccessors);
  const repairFunctionsString = safeStringifyFunction(repairFunctions);

  // Create a new unsafeRec from a brand new context, with new intrinsics and a
  // new global object
  function createNewUnsafeRec(allShims, configurableGlobals = false) {
    const unsafeGlobal = getNewUnsafeGlobal();
    const unsafeRec = createUnsafeRec(
      unsafeGlobal,
      allShims,
      configurableGlobals
    );
    const { unsafeEval } = unsafeRec;
    unsafeEval(repairAccessorsString)();
    unsafeEval(repairFunctionsString)();
    return unsafeRec;
  }

  // Create a new unsafeRec from the current context, where the Realm shim is
  // being parsed and executed, aka the "Primal Realm"
  function createCurrentUnsafeRec() {
    const unsafeEval = eval;
    const unsafeGlobal = unsafeEval(unsafeGlobalSrc);
    repairAccessors();
    repairFunctions();
    return createUnsafeRec(unsafeGlobal);
  }

  // todo: think about how this interacts with endowments, check for conflicts
  // between the names being optimized and the ones added by endowments

  /**
   * Simplified validation of indentifier names: may only contain alphanumeric
   * characters (or "$" or "_"), and may not start with a digit. This is safe
   * and does not reduces the compatibility of the shim. The motivation for
   * this limitation was to decrease the complexity of the implementation,
   * and to maintain a resonable level of performance.
   * Note: \w is equivalent [a-zA-Z_0-9]
   * See 11.6.1 Identifier Names
   */
  const identifierPattern = /^[a-zA-Z_$][\w$]*$/;

  /**
   * In JavaScript you cannot use these reserved words as variables.
   * See 11.6.1 Identifier Names
   */
  const keywords = new Set([
    // 11.6.2.1 Keywords
    'await',
    'break',
    'case',
    'catch',
    'class',
    'const',
    'continue',
    'debugger',
    'default',
    'delete',
    'do',
    'else',
    'export',
    'extends',
    'finally',
    'for',
    'function',
    'if',
    'import',
    'in',
    'instanceof',
    'new',
    'return',
    'super',
    'switch',
    'this',
    'throw',
    'try',
    'typeof',
    'var',
    'void',
    'while',
    'with',
    'yield',

    // Also reserved when parsing strict mode code
    'let',
    'static',

    // 11.6.2.2 Future Reserved Words
    'enum',

    // Also reserved when parsing strict mode code
    'implements',
    'package',
    'protected',
    'interface',
    'private',
    'public',

    // Reserved but not mentioned in specs
    'await',

    'null',
    'true',
    'false',

    'this',
    'arguments'
  ]);

  /**
   * getOptimizableGlobals()
   * What variable names might it bring into scope? These include all
   * property names which can be variable names, including the names
   * of inherited properties. It excludes symbols and names which are
   * keywords. We drop symbols safely. Currently, this shim refuses
   * service if any of the names are keywords or keyword-like. This is
   * safe and only prevent performance optimization.
   */
  function getOptimizableGlobals(globalObject, localObject = {}) {
    const globalNames = getOwnPropertyNames(globalObject);
    // getOwnPropertyNames does ignore Symbols so we don't need this extra check:
    // typeof name === 'string' &&
    const constants = arrayFilter(globalNames, name => {
      // Exclude globals that will be hidden behind an object positioned
      // closer in the resolution scope chain, typically the endowments.
      if (name in localObject) {
        return false;
      }

      // Ensure we have a valid identifier. We use regexpTest rather than
      // /../.test() to guard against the case where RegExp has been poisoned.
      if (
        name === 'eval' ||
        keywords.has(name) ||
        !regexpTest(identifierPattern, name)
      ) {
        return false;
      }

      const desc = getOwnPropertyDescriptor(globalObject, name);
      return (
        //
        // The getters will not have .writable, don't let the falsyness of
        // 'undefined' trick us: test with === false, not ! . However descriptors
        // inherit from the (potentially poisoned) global object, so we might see
        // extra properties which weren't really there. Accessor properties have
        // 'get/set/enumerable/configurable', while data properties have
        // 'value/writable/enumerable/configurable'.
        desc.configurable === false &&
        desc.writable === false &&
        //
        // Checks for data properties because they're the only ones we can
        // optimize (accessors are most likely non-constant). Descriptors can't
        // can't have accessors and value properties at the same time, therefore
        // this check is sufficient. Using explicit own property deal with the
        // case where Object.prototype has been poisoned.
        objectHasOwnProperty(desc, 'value')
      );
    });

    return constants;
  }

  /**
   * ScopeHandler manages a Proxy which serves as the global scope for the
   * safeEvaluator operation (the Proxy is the argument of a 'with' binding).
   * As described in createSafeEvaluator(), it has several functions:
   * - allow the very first (and only the very first) use of 'eval' to map to
   *   the real (unsafe) eval function, so it acts as a 'direct eval' and can
   *    access its lexical scope (which maps to the 'with' binding, which the
   *   ScopeHandler also controls).
   * - ensure that all subsequent uses of 'eval' map to the safeEvaluator,
   *   which lives as the 'eval' property of the safeGlobal.
   * - route all other property lookups at the safeGlobal.
   * - hide the unsafeGlobal which lives on the scope chain above the 'with'.
   * - ensure the Proxy invariants despite some global properties being frozen.
   *
   * @returns {ProxyHandler<any> & Record<string, any>}
   */
  function buildScopeHandler(
    unsafeRec,
    safeGlobal,
    endowments = {},
    sloppyGlobals = false
  ) {
    const { unsafeGlobal, unsafeEval } = unsafeRec;

    const { freeze, getOwnPropertyDescriptor } = Object;
    const { get: reflectGet, set: reflectSet } = Reflect;

    /**
     * alwaysThrowHandler is a proxy handler which throws on any trap called.
     * It's made from a proxy with a get trap that throws. Its target is
     * an immutable (frozen) object and is safe to share, except accross realms
     */
    const alwaysThrowHandler = new Proxy(freeze({}), {
      get(target, prop) {
        // todo: replace with throwTantrum
        throw new TypeError(
          `unexpected scope handler trap called: ${String(prop)}`
        );
      }
    });

    return {
      // The scope handler throws if any trap other than get/set/has are run
      // (e.g. getOwnPropertyDescriptors, apply, getPrototypeOf).
      // eslint-disable-next-line no-proto
      __proto__: alwaysThrowHandler,

      // This flag allow us to determine if the eval() call is an done by the
      // realm's code or if it is user-land invocation, so we can react differently.
      // We use a property and not an accessor to avoid increasing the stack trace
      // and reduce the possibility of OOM.
      useUnsafeEvaluator: false,

      get(shadow, prop) {
        if (typeof prop === 'symbol') {
          // Safe to return a primal realm Object here because the only code that
          // can do a get() on a non-string is the internals of with() itself,
          // and the only thing it does is to look for properties on it. User
          // code cannot do a lookup on non-strings.
          return undefined;
        }

        // Special treatment for eval. The very first lookup of 'eval' gets the
        // unsafe (real direct) eval, so it will get the lexical scope that uses
        // the 'with' context.
        if (prop === 'eval') {
          // test that it is true rather than merely truthy
          if (this.useUnsafeEvaluator === true) {
            // revoke before use
            this.useUnsafeEvaluator = false;
            return unsafeEval;
          }
          // fall through
        }

        // Properties of the endowments.
        if (prop in endowments) {
          // Ensure that the 'this' value on getters resolves
          // to the safeGlobal, not to the endowments object.
          return reflectGet(endowments, prop, safeGlobal);
        }

        // Properties of the global.
        return reflectGet(safeGlobal, prop);
      },

      // eslint-disable-next-line class-methods-use-this
      set(shadow, prop, value) {
        // Properties of the endowments.
        if (prop in endowments) {
          const desc = getOwnPropertyDescriptor(endowments, prop);
          if ('value' in desc) {
            // Work around a peculiar behavior in the specs, where
            // value properties are defined on the receiver.
            return reflectSet(endowments, prop, value);
          }
          // Ensure that the 'this' value on setters resolves
          // to the safeGlobal, not to the endowments object.
          return reflectSet(endowments, prop, value, safeGlobal);
        }

        // Properties of the global.
        return reflectSet(safeGlobal, prop, value);
      },

      // we need has() to return false for some names to prevent the lookup  from
      // climbing the scope chain and eventually reaching the unsafeGlobal
      // object, which is bad.

      // note: unscopables! every string in Object[Symbol.unscopables]

      // todo: we'd like to just have has() return true for everything, and then
      // use get() to raise a ReferenceError for anything not on the safe global.
      // But we want to be compatible with ReferenceError in the normal case and
      // the lack of ReferenceError in the 'typeof' case. Must either reliably
      // distinguish these two cases (the trap behavior might be different), or
      // we rely on a mandatory source-to-source transform to change 'typeof abc'
      // to XXX. We already need a mandatory parse to prevent the 'import',
      // since it's a special form instead of merely being a global variable/

      // note: if we make has() return true always, then we must implement a
      // set() trap to avoid subverting the protection of strict mode (it would
      // accept assignments to undefined globals, when it ought to throw
      // ReferenceError for such assignments)

      has(shadow, prop) {
        // proxies stringify 'prop', so no TOCTTOU danger here

        if (sloppyGlobals) {
          // Everything is potentially available.
          return true;
        }

        // unsafeGlobal: hide all properties of unsafeGlobal at the
        // expense of 'typeof' being wrong for those properties. For
        // example, in the browser, evaluating 'document = 3', will add
        // a property to safeGlobal instead of throwing a
        // ReferenceError.
        if (
          prop === 'eval' ||
          prop in endowments ||
          prop in safeGlobal ||
          prop in unsafeGlobal
        ) {
          return true;
        }

        return false;
      },

      // note: this is likely a bug of safari
      // https://bugs.webkit.org/show_bug.cgi?id=195534

      getPrototypeOf() {
        return null;
      }
    };
  }

  const buildScopeHandlerString = safeStringifyFunction(buildScopeHandler);

  function buildSafeEval(unsafeRec, safeEvalOperation) {
    const { callAndWrapError } = unsafeRec;

    const { defineProperties } = Object;

    // We use the the concise method syntax to create an eval without a
    // [[Construct]] behavior (such that the invocation "new eval()" throws
    // TypeError: eval is not a constructor"), but which still accepts a
    // 'this' binding.
    const safeEval = {
      eval() {
        return callAndWrapError(safeEvalOperation, arguments);
      }
    }.eval;

    // safeEval's prototype RootRealm's value and instanceof Function
    // is true inside the realm. It doesn't point at the primal realm
    // value, and there is no defense against leaking primal realm
    // intrinsics.

    defineProperties(safeEval, {
      toString: {
        // We break up the following literal string so that an
        // apparent direct eval syntax does not appear in this
        // file. Thus, we avoid rejection by the overly eager
        // rejectDangerousSources.
        value: () => `function ${'eval'}() { [shim code] }`,
        writable: false,
        enumerable: false,
        configurable: true
      }
    });

    return safeEval;
  }
  const buildSafeEvalString = safeStringifyFunction(buildSafeEval);

  function buildSafeFunction(unsafeRec, safeFunctionOperation) {
    const { callAndWrapError, unsafeFunction } = unsafeRec;

    const { defineProperties } = Object;

    const safeFunction = function Function() {
      return callAndWrapError(safeFunctionOperation, arguments);
    };

    // Ensure that Function from any compartment in a root realm can be used
    // with instance checks in any compartment of the same root realm.

    defineProperties(safeFunction, {
      // Ensure that any function created in any compartment in a root realm is an
      // instance of Function in any compartment of the same root ralm.
      prototype: { value: unsafeFunction.prototype },

      // Provide a custom output without overwriting the
      // Function.prototype.toString which is called by some third-party
      // libraries.
      toString: {
        value: () => 'function Function() { [shim code] }',
        writable: false,
        enumerable: false,
        configurable: true
      }
    });

    return safeFunction;
  }
  const buildSafeFunctionString = safeStringifyFunction(buildSafeFunction);

  function applyTransforms(rewriterState, transforms) {
    const { create, getOwnPropertyDescriptors } = Object;
    const { apply } = Reflect;
    const uncurryThis = fn => (thisArg, ...args) => apply(fn, thisArg, args);
    const arrayReduce = uncurryThis(Array.prototype.reduce);

    // Clone before calling transforms.
    rewriterState = {
      src: `${rewriterState.src}`,
      endowments: create(
        null,
        getOwnPropertyDescriptors(rewriterState.endowments)
      )
    };

    // Rewrite the source, threading through rewriter state as necessary.
    rewriterState = arrayReduce(
      transforms,
      (rs, transform) => (transform.rewrite ? transform.rewrite(rs) : rs),
      rewriterState
    );

    // Clone after transforms
    rewriterState = {
      src: `${rewriterState.src}`,
      endowments: create(
        null,
        getOwnPropertyDescriptors(rewriterState.endowments)
      )
    };

    return rewriterState;
  }

  const applyTransformsString = safeStringifyFunction(applyTransforms);

  // https://www.ecma-international.org/ecma-262/9.0/index.html#sec-html-like-comments
  // explains that JavaScript parsers may or may not recognize html
  // comment tokens "<" immediately followed by "!--" and "--"
  // immediately followed by ">" in non-module source text, and treat
  // them as a kind of line comment. Since otherwise both of these can
  // appear in normal JavaScript source code as a sequence of operators,
  // we have the terrifying possibility of the same source code parsing
  // one way on one correct JavaScript implementation, and another way
  // on another.
  //
  // This shim takes the conservative strategy of just rejecting source
  // text that contains these strings anywhere. Note that this very
  // source file is written strangely to avoid mentioning these
  // character strings explicitly.

  // We do not write the regexp in a straightforward way, so that an
  // apparennt html comment does not appear in this file. Thus, we avoid
  // rejection by the overly eager rejectDangerousSources.
  const htmlCommentPattern = new RegExp(`(?:${'<'}!--|--${'>'})`);

  function rejectHtmlComments(s) {
    const index = s.search(htmlCommentPattern);
    if (index !== -1) {
      const linenum = s.slice(0, index).split('\n').length; // more or less
      throw new SyntaxError(
        `possible html comment syntax rejected around line ${linenum}`
      );
    }
  }

  // The proposed dynamic import expression is the only syntax currently
  // proposed, that can appear in non-module JavaScript code, that
  // enables direct access to the outside world that cannot be
  // surpressed or intercepted without parsing and rewriting. Instead,
  // this shim conservatively rejects any source text that seems to
  // contain such an expression. To do this safely without parsing, we
  // must also reject some valid programs, i.e., those containing
  // apparent import expressions in literal strings or comments.

  // The current conservative rule looks for the identifier "import"
  // followed by either an open paren or something that looks like the
  // beginning of a comment. We assume that we do not need to worry
  // about html comment syntax because that was already rejected by
  // rejectHtmlComments.

  // this \s *must* match all kinds of syntax-defined whitespace. If e.g.
  // U+2028 (LINE SEPARATOR) or U+2029 (PARAGRAPH SEPARATOR) is treated as
  // whitespace by the parser, but not matched by /\s/, then this would admit
  // an attack like: import\u2028('power.js') . We're trying to distinguish
  // something like that from something like importnotreally('power.js') which
  // is perfectly safe.

  const importPattern = /\bimport\s*(?:\(|\/[/*])/;

  function rejectImportExpressions(s) {
    const index = s.search(importPattern);
    if (index !== -1) {
      const linenum = s.slice(0, index).split('\n').length; // more or less
      throw new SyntaxError(
        `possible import expression rejected around line ${linenum}`
      );
    }
  }

  // The shim cannot correctly emulate a direct eval as explained at
  // https://github.com/Agoric/realms-shim/issues/12
  // Without rejecting apparent direct eval syntax, we would
  // accidentally evaluate these with an emulation of indirect eval. Tp
  // prevent future compatibility problems, in shifting from use of the
  // shim to genuine platform support for the proposal, we should
  // instead statically reject code that seems to contain a direct eval
  // expression.
  //
  // As with the dynamic import expression, to avoid a full parse, we do
  // this approximately with a regexp, that will also reject strings
  // that appear safely in comments or strings. Unlike dynamic import,
  // if we miss some, this only creates future compat problems, not
  // security problems. Thus, we are only trying to catch innocent
  // occurrences, not malicious one. In particular, `(eval)(...)` is
  // direct eval syntax that would not be caught by the following regexp.

  const someDirectEvalPattern = /\beval\s*(?:\(|\/[/*])/;

  function rejectSomeDirectEvalExpressions(s) {
    const index = s.search(someDirectEvalPattern);
    if (index !== -1) {
      const linenum = s.slice(0, index).split('\n').length; // more or less
      throw new SyntaxError(
        `possible direct eval expression rejected around line ${linenum}`
      );
    }
  }

  function rejectDangerousSources(s) {
    rejectHtmlComments(s);
    rejectImportExpressions(s);
    rejectSomeDirectEvalExpressions(s);
  }

  // Export a rewriter transform.
  const rejectDangerousSourcesTransform = {
    rewrite(rs) {
      rejectDangerousSources(rs.src);
      return rs;
    }
  };

  // Portions adapted from V8 - Copyright 2016 the V8 project authors.

  function buildOptimizer(constants) {
    // No need to build an oprimizer when there are no constants.
    if (constants.length === 0) return '';
    // Use 'this' to avoid going through the scope proxy, which is unecessary
    // since the optimizer only needs references to the safe global.
    return `const {${arrayJoin(constants, ',')}} = this;`;
  }

  function createScopedEvaluatorFactory(unsafeRec, constants) {
    const { unsafeFunction } = unsafeRec;

    const optimizer = buildOptimizer(constants);

    // Create a function in sloppy mode, so that we can use 'with'. It returns
    // a function in strict mode that evaluates the provided code using direct
    // eval, and thus in strict mode in the same scope. We must be very careful
    // to not create new names in this scope

    // 1: we use 'with' (around a Proxy) to catch all free variable names. The
    // first 'arguments[0]' holds the Proxy which safely wraps the safeGlobal
    // 2: 'optimizer' catches common variable names for speed
    // 3: The inner strict function is effectively passed two parameters:
    //    a) its arguments[0] is the source to be directly evaluated.
    //    b) its 'this' is the this binding seen by the code being
    //       directly evaluated.

    // everything in the 'optimizer' string is looked up in the proxy
    // (including an 'arguments[0]', which points at the Proxy). 'function' is
    // a keyword, not a variable, so it is not looked up. then 'eval' is looked
    // up in the proxy, that's the first time it is looked up after
    // useUnsafeEvaluator is turned on, so the proxy returns the real the
    // unsafeEval, which satisfies the IsDirectEvalTrap predicate, so it uses
    // the direct eval and gets the lexical scope. The second 'arguments[0]' is
    // looked up in the context of the inner function. The *contents* of
    // arguments[0], because we're using direct eval, are looked up in the
    // Proxy, by which point the useUnsafeEvaluator switch has been flipped
    // back to 'false', so any instances of 'eval' in that string will get the
    // safe evaluator.

    return unsafeFunction(`
    with (arguments[0]) {
      ${optimizer}
      return function() {
        'use strict';
        return eval(arguments[0]);
      };
    }
  `);
  }

  function createSafeEvaluatorFactory(
    unsafeRec,
    safeGlobal,
    transforms,
    sloppyGlobals
  ) {
    const { unsafeEval } = unsafeRec;
    const applyTransforms = unsafeEval(applyTransformsString);

    function factory(endowments = {}, options = {}) {
      // todo clone all arguments passed to returned function
      const localTransforms = options.transforms || [];
      const realmTransforms = transforms || [];

      const mandatoryTransforms = [rejectDangerousSourcesTransform];
      const allTransforms = arrayConcat(
        localTransforms,
        realmTransforms,
        mandatoryTransforms
      );

      function safeEvalOperation(src) {
        let rewriterState = { src, endowments };
        rewriterState = applyTransforms(rewriterState, allTransforms);

        // Combine all optimizable globals.
        const globalConstants = getOptimizableGlobals(
          safeGlobal,
          rewriterState.endowments
        );
        const localConstants = getOptimizableGlobals(rewriterState.endowments);
        const constants = arrayConcat(globalConstants, localConstants);

        const scopedEvaluatorFactory = createScopedEvaluatorFactory(
          unsafeRec,
          constants
        );

        const scopeHandler = unsafeEval(buildScopeHandlerString)(
          unsafeRec,
          safeGlobal,
          rewriterState.endowments,
          sloppyGlobals
        );
        const scopeProxyRevocable = Proxy.revocable({}, scopeHandler);
        const scopeProxy = scopeProxyRevocable.proxy;
        const scopedEvaluator = apply(scopedEvaluatorFactory, safeGlobal, [
          scopeProxy
        ]);

        scopeHandler.useUnsafeEvaluator = true;
        let err;
        try {
          // Ensure that "this" resolves to the safe global.
          return apply(scopedEvaluator, safeGlobal, [rewriterState.src]);
        } catch (e) {
          // stash the child-code error in hopes of debugging the internal failure
          err = e;
          throw e;
        } finally {
          if (scopeHandler.useUnsafeEvaluator) {
            // the proxy switches this off immediately after ths
            // first access, but if that's not the case we prevent
            // further variable resolution on the scope and abort.
            scopeProxyRevocable.revoke();
            throwTantrum('handler did not revoke useUnsafeEvaluator', err);
          }
        }
      }

      return safeEvalOperation;
    }

    return factory;
  }

  function createSafeEvaluator(unsafeRec, safeEvalOperation) {
    const { unsafeEval, unsafeFunction } = unsafeRec;

    const safeEval = unsafeEval(buildSafeEvalString)(
      unsafeRec,
      safeEvalOperation
    );

    assert(getPrototypeOf(safeEval).constructor !== Function, 'hide Function');
    assert(
      getPrototypeOf(safeEval).constructor !== unsafeFunction,
      'hide unsafeFunction'
    );

    return safeEval;
  }

  function createSafeEvaluatorWhichTakesEndowments(safeEvaluatorFactory) {
    return (x, endowments, options = {}) =>
      safeEvaluatorFactory(endowments, options)(x);
  }

  /**
   * A safe version of the native Function which relies on
   * the safety of evalEvaluator for confinement.
   */
  function createFunctionEvaluator(unsafeRec, safeEvalOperation) {
    const { unsafeGlobal, unsafeEval, unsafeFunction } = unsafeRec;

    function safeFunctionOperation(...params) {
      const functionBody = `${arrayPop(params) || ''}`;
      let functionParams = `${arrayJoin(params, ',')}`;
      if (!regexpTest(/^[\w\s,]*$/, functionParams)) {
        throw new SyntaxError(
          'shim limitation: Function arg must be simple ASCII identifiers, possibly separated by commas: no default values, pattern matches, or non-ASCII parameter names'
        );
        // this protects against Matt Austin's clever attack:
        // Function("arg=`", "/*body`){});({x: this/**/")
        // which would turn into
        //     (function(arg=`
        //     /*``*/){
        //      /*body`){});({x: this/**/
        //     })
        // which parses as a default argument of `\n/*``*/){\n/*body` , which
        // is a pair of template literals back-to-back (so the first one
        // nominally evaluates to the parser to use on the second one), which
        // can't actually execute (because the first literal evals to a string,
        // which can't be a parser function), but that doesn't matter because
        // the function is bypassed entirely. When that gets evaluated, it
        // defines (but does not invoke) a function, then evaluates a simple
        // {x: this} expression, giving access to the safe global.
      }

      // Is this a real functionBody, or is someone attempting an injection
      // attack? This will throw a SyntaxError if the string is not actually a
      // function body. We coerce the body into a real string above to prevent
      // someone from passing an object with a toString() that returns a safe
      // string the first time, but an evil string the second time.
      // eslint-disable-next-line no-new, new-cap
      new unsafeFunction(functionBody);

      if (stringIncludes(functionParams, ')')) {
        // If the formal parameters string include ) - an illegal
        // character - it may make the combined function expression
        // compile. We avoid this problem by checking for this early on.

        // note: v8 throws just like this does, but chrome accepts
        // e.g. 'a = new Date()'
        throw new unsafeGlobal.SyntaxError(
          'shim limitation: Function arg string contains parenthesis'
        );
        // todo: shim integrity threat if they change SyntaxError
      }

      // todo: check to make sure this .length is safe. markm says safe.
      if (functionParams.length > 0) {
        // If the formal parameters include an unbalanced block comment, the
        // function must be rejected. Since JavaScript does not allow nested
        // comments we can include a trailing block comment to catch this.
        functionParams += '\n/*``*/';
      }

      const src = `(function(${functionParams}){\n${functionBody}\n})`;

      return safeEvalOperation(src);
    }

    const safeFunction = unsafeEval(buildSafeFunctionString)(
      unsafeRec,
      safeFunctionOperation
    );

    assert(
      getPrototypeOf(safeFunction).constructor !== Function,
      'hide Function'
    );
    assert(
      getPrototypeOf(safeFunction).constructor !== unsafeFunction,
      'hide unsafeFunction'
    );

    return safeFunction;
  }

  // Mimic private members on the realm instances.
  // We define it in the same module and do not export it.
  const RealmRecForRealmInstance = new WeakMap();

  function getRealmRecForRealmInstance(realm) {
    // Detect non-objects.
    assert(Object(realm) === realm, 'bad object, not a Realm instance');
    // Realm instance has no realmRec. Should not proceed.
    assert(RealmRecForRealmInstance.has(realm), 'Realm instance has no record');

    return RealmRecForRealmInstance.get(realm);
  }

  function registerRealmRecForRealmInstance(realm, realmRec) {
    // Detect non-objects.
    assert(Object(realm) === realm, 'bad object, not a Realm instance');
    // Attempt to change an existing realmRec on a realm instance. Should not proceed.
    assert(
      !RealmRecForRealmInstance.has(realm),
      'Realm instance already has a record'
    );

    RealmRecForRealmInstance.set(realm, realmRec);
  }

  // Initialize the global variables for the new Realm.
  function setDefaultBindings(safeGlobal, safeEval, safeFunction) {
    defineProperties(safeGlobal, {
      eval: {
        value: safeEval,
        writable: true,
        configurable: true
      },
      Function: {
        value: safeFunction,
        writable: true,
        configurable: true
      }
    });
  }

  function createRealmRec(unsafeRec, transforms, sloppyGlobals) {
    const { sharedGlobalDescs, unsafeGlobal } = unsafeRec;

    const safeGlobal = create(unsafeGlobal.Object.prototype, sharedGlobalDescs);

    const safeEvaluatorFactory = createSafeEvaluatorFactory(
      unsafeRec,
      safeGlobal,
      transforms,
      sloppyGlobals
    );
    const safeEvalOperation = safeEvaluatorFactory();
    const safeEval = createSafeEvaluator(unsafeRec, safeEvalOperation);
    const safeFunction = createFunctionEvaluator(unsafeRec, safeEvalOperation);
    const safeEvalWhichTakesEndowments = createSafeEvaluatorWhichTakesEndowments(
      safeEvaluatorFactory
    );

    setDefaultBindings(safeGlobal, safeEval, safeFunction);

    const realmRec = freeze({
      safeGlobal,
      safeEval,
      safeEvalWhichTakesEndowments,
      safeFunction
    });

    return realmRec;
  }

  /**
   * A root realm uses a fresh set of new intrinics. Here we first create
   * a new unsafe record, which inherits the shims. Then we proceed with
   * the creation of the realm record, and we apply the shims.
   */
  function initRootRealm(parentUnsafeRec, self, options) {
    // note: 'self' is the instance of the Realm.

    // todo: investigate attacks via Array.species
    // todo: this accepts newShims='string', but it should reject that
    const {
      shims: newShims,
      transforms,
      sloppyGlobals,
      configurableGlobals
    } = options;
    const allShims = arrayConcat(parentUnsafeRec.allShims, newShims);

    // The unsafe record is created already repaired.
    const unsafeRec = createNewUnsafeRec(allShims, configurableGlobals);
    const { unsafeEval } = unsafeRec;

    const Realm = unsafeEval(buildChildRealmString)(
      unsafeRec,
      // eslint-disable-next-line no-use-before-define
      BaseRealm
    );

    // Add a Realm descriptor to sharedGlobalDescs, so it can be defined onto the
    // safeGlobal like the rest of the globals.
    unsafeRec.sharedGlobalDescs.Realm = {
      value: Realm,
      writable: true,
      configurable: true
    };

    // Creating the realmRec provides the global object, eval() and Function()
    // to the realm.
    const realmRec = createRealmRec(unsafeRec, transforms, sloppyGlobals);

    // Apply all shims in the new RootRealm. We don't do this for compartments.
    const { safeEvalWhichTakesEndowments } = realmRec;
    for (const shim of allShims) {
      safeEvalWhichTakesEndowments(shim);
    }

    // The realmRec acts as a private field on the realm instance.
    registerRealmRecForRealmInstance(self, realmRec);
  }

  /**
   * A compartment shares the intrinsics of its root realm. Here, only a
   * realmRec is necessary to hold the global object, eval() and Function().
   */
  function initCompartment(unsafeRec, self, options = {}) {
    // note: 'self' is the instance of the Realm.

    const { transforms, sloppyGlobals } = options;
    const realmRec = createRealmRec(unsafeRec, transforms, sloppyGlobals);

    // The realmRec acts as a private field on the realm instance.
    registerRealmRecForRealmInstance(self, realmRec);
  }

  function getRealmGlobal(self) {
    const { safeGlobal } = getRealmRecForRealmInstance(self);
    return safeGlobal;
  }

  function realmEvaluate(self, x, endowments = {}, options = {}) {
    // todo: don't pass in primal-realm objects like {}, for safety. OTOH its
    // properties are copied onto the new global 'target'.
    // todo: figure out a way to membrane away the contents to safety.
    const { safeEvalWhichTakesEndowments } = getRealmRecForRealmInstance(self);
    return safeEvalWhichTakesEndowments(x, endowments, options);
  }

  const BaseRealm = {
    initRootRealm,
    initCompartment,
    getRealmGlobal,
    realmEvaluate
  };

  // Create the current unsafeRec from the current "primal" environment (the realm
  // where the Realm shim is loaded and executed).
  const currentUnsafeRec = createCurrentUnsafeRec();

  /**
   * The "primal" realm class is defined in the current "primal" environment,
   * and is part of the shim. There is no need to facade this class via evaluation
   * because both share the same intrinsics.
   */
  const Realm = buildChildRealm(currentUnsafeRec, BaseRealm);

  function sealGlobal({ rootRealm, compartment }) {
    const { seal } = Object;
    const { defineProperty, getOwnPropertyDescriptor, ownKeys } = Reflect;
    const freezeProperty = (object, name) => {
      const descriptor = getOwnPropertyDescriptor(object, name);

      if (!descriptor || !descriptor.configurable) {
        return;
      }

      // eslint-disable-next-line no-prototype-builtins
      if (descriptor.hasOwnProperty('value')) {
        const value = descriptor.value;
        delete descriptor.value;
        delete descriptor.writable;

        descriptor.get = () => value;
        descriptor.set = function(value) {
          if (this !== object) {
            defineProperty(this, name, {
              configurable: true,
              enumerable: true,
              value,
              writable: true
            });
          } else {
            throw TypeError(
              `Cannot assign to read only property '${name}' of object '#<${object}>'`
            );
          }
        };
      }

      descriptor.configurable = false;
      defineProperty(object, name, descriptor);
    };

    // 保险起见删除全局对象中的 Realm 引用
    delete compartment.global.Realm;

    // 安全措施：将 ES 原生对象与方法设置为只读
    // 由于 compartment 之间共享了 ES 的原生对象与方法，这可能让沙箱之间有机会通过复写原型对象的方式来进行恶意操作
    ownKeys(rootRealm.global)
      .map(key => rootRealm.global[key])
      .filter(
        target =>
          (target && typeof target === 'object') || typeof target === 'function'
      )
      .forEach(target => {
        ownKeys(target).forEach(key => {
          freezeProperty(target, key);
        });
        seal(target);

        if (target.prototype) {
          ownKeys(target.prototype).forEach(key => {
            freezeProperty(target.prototype, key);
          });
          seal(target.prototype);
        }
      });
  }

  /* global window */

  let realm;
  function createCompartment() {
    if (!realm) {
      realm = Realm.makeRootRealm();
      const iframe = window.document.body.lastChild;

      // realms-shim 通过 iframe 创建执行环境，但 iframe 没有从主文档中删除，它在源代码中明确说明不确定是否有副作用。
      // iframe 从主文档中断开：
      // 已知好处：
      // 1. iframe 中的脚本永远无法通过 top 访问到主文档——虽然 realms-shim 足够让人信任，隔离 top 是它基本功，但对于安全问题的处理上再小心也不为过
      // 2. 有助于减少资源占用——这一点凭固有经验想象而来，需要进行测试
      // 已知的副作用：
      // 1. 沙箱脚本不再出现在 Chrome 开发者工具的 Source 面板中，因此难以通过断点调试沙箱脚本——但这对生产环境不是问题
      // 2. Chrome bug: 来自 iframe 中的 function 无法作为主文档的事件回调函数——但如果使用主文档的函数包裹 iframe 的 function 就可以绕开此问题，但是这样影响面非常大
      if (
        iframe.nodeName === 'IFRAME' &&
        iframe.contentWindow &&
        realm.global instanceof iframe.contentWindow.Object
      ) {
        const doc = iframe.contentDocument;
        doc.removeChild(doc.documentElement);
        Object.defineProperties(iframe, {
          contentWindow: {},
          contentDocument: {}
        });
      }
    }

    // 受限于 realms-shim 的实现，使用 makeRootRealm() 会创建一个新的 iframe，这样会引起性能问题
    // 使用 makeCompartment() 可以让所有沙箱共享一个 iframe 以减少内存占用
    const compartment = realm.global.Realm.makeCompartment();
    const evaluate = compartment.evaluate;
    compartment.evaluate = function(source, ...options) {
      // realms-shim 禁止了包含 ES `import` 代码的执行，但是它的正则表达式有缺陷。例如 `System.import` 也将被禁止
      // TODO 要修复这个问题需要帮助 realms-shim 来完善 `import` 检查逻辑，在这里是一个临时方案规避此问题
      source = source.replace(/\.import\(/g, `['import'](`);
      return evaluate.call(this, source, ...options);
    };

    realm.evaluate(`(${sealGlobal.toString()})`)({
      rootRealm: realm,
      compartment
    });

    return compartment;
  }

  function parsePolicy(policy) {
    return policy.split(';').reduce((result, directive) => {
      const [directiveKey, ...directiveValue] = directive.trim().split(/\s+/g);
      if (
        directiveKey &&
        !Object.prototype.hasOwnProperty.call(result, directiveKey)
      ) {
        result[directiveKey] = directiveValue.includes("'none'")
          ? []
          : directiveValue;
      }
      return result;
    }, {});
  }

  var defaultCsp = "default-src 'none'";

  /**
   * 依赖注入服务
   */
  class Injector {
    constructor() {
      this.dependencies = new Map();
    }

    register(name, value) {
      this.dependencies.set(name, value);
    }

    // eslint-disable-next-line class-methods-use-this
    fallback(name) {
      throw new Error(`Injector: Can't resolve ${name}`);
    }

    resolve(func, scope = null) {
      const injector = this;
      const dependencies = new Proxy(Object.create(null), {
        get(target, name) {
          if (typeof name !== 'string') {
            return undefined;
          }
          if (!injector.dependencies.has(name)) {
            return injector.fallback(name);
          }
          return injector.dependencies.get(name);
        }
      });

      return function resolve() {
        return func.apply(scope, [dependencies, ...arguments]);
      };
    }
  }

  /* global window, document */

  /**
   * isJavaScriptType
   *
   * @param  {String} value
   * @return {Boolean}
   */
  const isJavaScriptType = value => {
    if (
      typeof value === 'string' &&
      // https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/MIME_types#textjavascript
      [
        '',
        'module',
        'application/javascript',
        'application/ecmascript',
        'text/javascript',
        'text/ecmascript'
      ].includes(value.trim().toLowerCase())
    ) {
      return true;
    }

    // 我们仍然需要在运行时进行检测的原因：
    // 1. 浏览器可能未来可能新增可执行类型
    // 2. 浏览器会尝试对字符串进行修正，这种修正往往难以琢磨
    // 3. 历史兼容问题

    const WEBSANDBOX_PREVENT_SCRIPT_TYPE = 'WEBSANDBOX_PREVENT_SCRIPT_TYPE';
    let cache = window[WEBSANDBOX_PREVENT_SCRIPT_TYPE];

    if (!cache) {
      cache = window[WEBSANDBOX_PREVENT_SCRIPT_TYPE] = new Map();
    }

    if (cache.has(value)) {
      return cache.get(value);
    }

    cache.set(value, false);

    const script = document.createElement('script');

    script.setAttribute('type', value);
    script.textContent = `${WEBSANDBOX_PREVENT_SCRIPT_TYPE}.set(${JSON.stringify(
    value
  )}, true)`;

    // 注意： type=module 是异步运行
    document.head.appendChild(script);

    const result = cache.get(value);
    document.head.removeChild(script);
    return result;
  };

  /**
   * 绑定虚拟对象与真实对象
   * @param   {object}  virtualObject
   * @param   {object}  nativeObject
   */
  function bindObject(
    { nativeCache, virtualCache },
    virtualObject,
    $nativeObject
  ) {
    nativeCache.set(virtualObject, $nativeObject);
    virtualCache.set($nativeObject, virtualObject);
  }

  /**
   * 运行函数，并将异常虚拟化
   * @param   {function}   target  目标
   * @param   {?any}       context 上下文
   * @param   {?array}     params  参数
   */
  // eslint-disable-next-line consistent-return
  function callAndWrapError(
    { global, langUtils: { apply, isObject }, toVirtualAny },
    target,
    context,
    args = []
  ) {
    try {
      return apply(target, context, args);
    } catch (error) {
      if (isObject(error) && error instanceof global.Object) {
        throw error;
      }
      throw toVirtualAny(error);
    }
  }

  function createVirtualClass({
    bindObject,
    callAndWrapError,
    currentNativeObject,
    evaluate,
    global,
    parent,
    symbols: { initializedCallback },
    toNativeAny,
    toVirtualAny,
    langUtils: {
      setPrototypeOf,
      defineProperties,
      from,
      getOwnPropertyDescriptor,
      isObject,
      ownKeys,
      construct,
      create
    }
  }) {
    const createVirtualClassProxy = evaluate(
      (
        bindObject,
        callAndWrapError,
        construct,
        create,
        currentNativeObject,
        defineProperties,
        from,
        getOwnPropertyDescriptor,
        global,
        initializedCallback,
        isObject,
        NativeClass,
        ownKeys,
        parent,
        properties,
        setPrototypeOf,
        toNativeAny,
        toVirtualAny,
        VirtualSuperClass
      ) => {
        const name = NativeClass.name;
        const init = getOwnPropertyDescriptor(properties, initializedCallback);
        const callback = init && init.value;

        function VirtualClassProxy() {
          const constructor = () => {
            let virtualObject = this;
            let $nativeObject = currentNativeObject.get();

            if ($nativeObject) {
              /* 内部调用：toVirtualObject() 或 customElements.upgrade() 调用 */

              bindObject(virtualObject, $nativeObject);

              if (VirtualSuperClass) {
                construct(VirtualSuperClass, arguments, VirtualClassProxy);
              }
            } else {
              /* 用户代码调用：例如 new Event() 或 Event() */

              const $params = from(arguments).map(param => toNativeAny(param));

              if (new.target !== undefined) {
                // 作为构造器调用
                $nativeObject = construct(NativeClass, $params);
                if (isObject($nativeObject)) {
                  bindObject(virtualObject, $nativeObject);
                }
              } else {
                // 作为普通函数调用
                const $context = this // 此时 this 可能为 Proxy(global, {...})
                  ? this === global || this.window === global
                    ? parent
                    : toNativeAny(this)
                  : undefined;
                $nativeObject = NativeClass.apply($context, $params);
                return toVirtualAny($nativeObject);
              }
            }

            if (callback) {
              currentNativeObject.set($nativeObject);
              virtualObject = callback.call(virtualObject, ...arguments);
            }

            return virtualObject;
          };

          return callAndWrapError(constructor);
        }

        if (NativeClass.prototype) {
          const descriptor = {
            constructor: {
              configurable: true,
              value: VirtualClassProxy,
              writable: true
            },
            [Symbol.toStringTag]: {
              configurable: true,
              value:
                (NativeClass.prototype &&
                  NativeClass.prototype[Symbol.toStringTag]) ||
                name
            },
            ...ownKeys(properties).reduce((accumulator, name) => {
              const descriptor = getOwnPropertyDescriptor(properties, name);

              accumulator[name] = descriptor;
              return accumulator;
            }, {})
          };

          if (VirtualSuperClass) {
            setPrototypeOf(VirtualClassProxy, VirtualSuperClass);
            VirtualClassProxy.prototype = create(
              VirtualSuperClass.prototype,
              descriptor
            );
          } else {
            defineProperties(VirtualClassProxy.prototype, descriptor);
          }

          defineProperties(VirtualClassProxy, {
            prototype: {
              configurable: false,
              enumerable: false,
              writable: false
            }
          });
        } else {
          VirtualClassProxy.prototype = undefined;
        }

        defineProperties(VirtualClassProxy, {
          name: {
            value: name,
            configurable: true
          }
        });

        return VirtualClassProxy;
      }
    );

    return function createVirtualClass(
      NativeClass,
      properties = {},
      VirtualSuperClass
    ) {
      return createVirtualClassProxy(
        bindObject,
        callAndWrapError,
        construct,
        create,
        currentNativeObject,
        defineProperties,
        from,
        getOwnPropertyDescriptor,
        global,
        initializedCallback,
        isObject,
        NativeClass,
        ownKeys,
        parent,
        properties,
        setPrototypeOf,
        toNativeAny,
        toVirtualAny,
        VirtualSuperClass
      );
    };
  }

  createVirtualClass.cacheResult = true;

  /**
   * 将真实 BOM 环境中的对象自身属性转换为虚拟环境中的"实时"代理对象
   * 和 bridge.toVirtualObject() 的区别：
   * 1. 可以实时的代理目标自身属性，而 toVirtualObject() 是静态代理
   * 2. 没有缓存，重复调用将会返回不同的代理对象（但子对象有缓存）
   * @param {object}  $nativeObject   目标对象
   */
  function toLiveVirtuaObject(
    { toNativeAny, toVirtualAny, callAndWrapError },
    $nativeObject
  ) {
    // TODO 评估是否有修改原生对象的原型链的安全隐患
    return new Proxy(
      $nativeObject,
      [
        'apply',
        'construct',
        'defineProperty',
        'deleteProperty',
        'get',
        'getOwnPropertyDescriptor',
        'getPrototypeOf',
        'has',
        'isExtensible',
        'ownKeys',
        'preventExtensions',
        'set',
        'setPrototypeOf'
      ].reduce((accumulator, name) => {
        accumulator[name] = (...params) => {
          const args = params.map(p => toNativeAny(p));
          const result = callAndWrapError(Reflect[name], Reflect, args);
          return toVirtualAny(result);
        };
        return accumulator;
      }, {})
    );
  }

  /**
   * 虚拟环境中的数据转换成真实环境中的数据
   * @param {any} value 虚拟环境中的数据
   * @return {any} 真实环境中的数据
   */
  function toNativeAny(
    { langUtils: { isObject, isFunction }, toNativeObject, toNativeFunction },
    value
  ) {
    if (isObject(value)) {
      return toNativeObject(value);
    }
    if (isFunction(value)) {
      return toNativeFunction(value);
    }

    return value;
  }

  /**
   * 向真实环境注册的回调函数。例如:
   * 1. elem.addEventListener(type, callback) 中的 callback
   * 2. elem.onclick = click 中的 click
   * @param {function} callback 目标函数
   * @return {function} proxy 经过安全机制代理的新的函数
   */
  function toNativeFunction({
    langUtils: { defineProperty },
    nativeCache,
    toNativeAny,
    toVirtualAny
  }) {
    const createNativeFunctionProxy = callback => {
      function nativeFunctionProxy(...$params) {
        const $context = this;
        const context = toVirtualAny($context);
        const params = $params.map($param => toVirtualAny($param));
        // TODO 转换虚拟化的异常对象到真实
        const result = Reflect.apply(callback, context, params);
        return toNativeAny(result);
      }

      defineProperty(nativeFunctionProxy, 'name', {
        value: callback.name,
        configurable: true
      });

      return nativeFunctionProxy;
    };

    return function toNativeFunction(callback) {
      if (nativeCache.has(callback)) {
        return nativeCache.get(callback);
      }

      const proxy = createNativeFunctionProxy(callback);

      nativeCache.set(callback, proxy);
      return proxy;
    };
  }

  toNativeFunction.cacheResult = true;

  /**
   * 将虚拟的代理对象转换为真实 BOM 环境中的对象
   * @param  {object} virtualObject 目标对象
   * @return {object} 宿主中的对象
   */
  function toNativeObject({ nativeCache }, virtualObject) {
    const $nativeObject = nativeCache.get(virtualObject);
    if ($nativeObject) {
      return $nativeObject;
    }

    return virtualObject;
  }

  /**
   * 真实 BOM 环境任意值的虚拟化。例如 element.nodeName 中的 nodeName
   * @param {any} value 真实环境中的数据
   * @return {any} 虚拟化的数据
   */
  function toVirtualAny(
    { langUtils: { isObject, isFunction }, toVirtualObject, toVirtualFunction },
    $value
  ) {
    if (isObject($value)) {
      return toVirtualObject($value);
    }
    if (isFunction($value)) {
      return toVirtualFunction($value);
    }

    return $value;
  }

  function CSSStyleSheet({ documentView: $documentView, toNativeObject }) {
    return {
      insertRule(rule, index) {
        const $target = toNativeObject(this);
        if (
          !rule.includes(':host') ||
          !$documentView.contains($target.ownerNode)
        ) {
          $target.insertRule(rule, index);
        }
        return index;
      },
      addRule(selector, styleBlock, index) {
        const $target = toNativeObject(this);
        if (
          !selector.includes(':host') ||
          !$documentView.contains($target.ownerNode)
        ) {
          $target.addRule(selector, styleBlock, index);
        }
        return -1;
      }
    };
  }

  function CustomElementRegistry({
    bindObject,
    currentNativeObject,
    customElements,
    global,
    langUtils: { create, construct, setPrototypeOf, inherits, isArray },
    symbols: { elementDefined },
    toNativeObject
  }) {
    const whenDefinedCache = new Map();
    return {
      define(name, constructor, options = {}) {
        if (customElements.has(name)) {
          throw new TypeError(
            `customElements: The "${name}" has been registered`
          );
        }

        if (!name.includes('-')) {
          throw new TypeError(`Illegal constructor`);
        }

        const observedAttributes = constructor.observedAttributes;

        customElements.set(name, {
          constructor,
          observedAttributes: isArray(observedAttributes)
            ? [...observedAttributes]
            : [],
          options
        });

        if (whenDefinedCache.has(name)) {
          let resolve;
          while ((resolve = whenDefinedCache.get(name).shift())) {
            resolve();
          }
        }

        global.document
          .querySelectorAll(
            options.extends ? `${options.extends}[is="${name}"]` : name
          )
          .forEach(element => {
            this.upgrade(element);
          });
      },

      get(name) {
        const customElement = customElements.get(name);
        return customElement ? customElement.constructor : undefined;
      },

      upgrade(element) {
        const name = element.getAttribute('is') || element.localName;
        const describe = customElements.get(name);

        if (!describe || element instanceof describe.constructor) {
          return;
        }

        const $element = toNativeObject(element);
        currentNativeObject.set($element);
        const customElement = construct(describe.constructor, []);
        currentNativeObject.set(null);

        setPrototypeOf(
          element,
          inherits(customElement, create(describe.constructor.prototype))
        );

        $element.setAttribute(elementDefined, '');

        bindObject(element, $element);

        if (
          describe.observedAttributes.length &&
          element.attributeChangedCallback
        ) {
          for (const attr of describe.observedAttributes) {
            const val = element.getAttribute(attr);
            if (val) {
              element.attributeChangedCallback(attr, null, val);
            }
          }
        }

        if ($element.isConnected && element.connectedCallback) {
          element.connectedCallback();
        }
      },

      whenDefined(name) {
        if (customElements.get(name)) {
          return Promise.resolve();
        }

        return new Promise((resolve /* , reject */) => {
          if (!whenDefinedCache.has(name)) {
            whenDefinedCache.set(name, []);
          }
          whenDefinedCache.get(name).push(resolve);
        });
      }
    };
  }

  // Document 类代理的是真实环境中的 ShadowRoot 对象，而真实环境中的 document
  function Document({
    currentScript,
    global,
    toNativeObject,
    langUtils: { defineProperty, from, keys },
    parent: $parent,
    SandboxSecurityError,
    sanitizer,
    toNativeAny,
    toVirtualAny
  }) {
    const ONEVENT_CACHE = new WeakMap();
    const $document = $parent.document;

    const toVirtualNodeCreater = name =>
      function() {
        const $params = from(arguments).map(param => toNativeAny(param));
        const $result = $document[name](...$params);
        const result = toVirtualAny($result);

        return result;
      };

    const toVirtualElementCreater = method =>
      function(...p) {
        const createElement = 'createElement';
        const createElementNS = 'createElementNS';
        const params = {
          [createElement]: {
            name: p[0],
            options: p[1]
          },
          [createElementNS]: {
            ns: p[0],
            name: p[1],
            options: p[2]
          }
        }[method];

        if (!sanitizer.isValidElement(params.name)) {
          throw new SandboxSecurityError(`Forbidden: tag <${params.name} />`);
        }

        const $element = $document[method](...p);
        if (params.options) {
          if (!sanitizer.isValidElement(params.options.is)) {
            throw new SandboxSecurityError(
              `Forbidden: tag <${params.name} is="${params.options.is}" />`
            );
          }
          // TODO 浏览器并不会创建一个 is 的属性
          $element.setAttribute('is', params.options.is);
        }

        const element = toVirtualAny($element);
        global.customElements.upgrade(element);
        return element;
      };

    const adoptNode = toVirtualNodeCreater('adoptNode');
    const createAttribute = toVirtualNodeCreater('createAttribute');
    const createAttributeNS = toVirtualNodeCreater('createAttributeNS');
    const createCDATASection = toVirtualNodeCreater('createCDATASection');
    const createComment = toVirtualNodeCreater('createComment');
    const createDocumentFragment = toVirtualNodeCreater('createDocumentFragment');
    const createElement = toVirtualElementCreater('createElement');
    const createElementNS = toVirtualElementCreater('createElementNS');
    const createEvent = toVirtualNodeCreater('createEvent');
    const createNodeIterator = toVirtualNodeCreater('createNodeIterator');
    const createProcessingInstruction = toVirtualNodeCreater(
      'createProcessingInstruction'
    );
    const createTextNode = toVirtualNodeCreater('createTextNode');
    const createTreeWalker = toVirtualNodeCreater('createTreeWalker');
    const importNode = toVirtualNodeCreater('importNode');

    const properties = {
      adoptNode,

      get adoptedStyleSheets() {
        const $target = toNativeObject(this);
        return toVirtualAny($target.adoptedStyleSheets);
      },

      set adoptedStyleSheets(value) {
        const $target = toNativeObject(this);
        const $list = toNativeAny(value).map(item => toNativeAny(item));
        $target.adoptedStyleSheets = $list;
      },

      get body() {
        return this.querySelector('body');
      },

      get characterSet() {
        return $document.characterSet;
      },

      get contentType() {
        return $document.contentType;
      },

      createAttribute,
      createAttributeNS,
      createCDATASection,
      createComment,
      createDocumentFragment,
      createElement,
      createElementNS,
      createEvent, // 已经过时，但 Vue v2 依赖了此方法
      createNodeIterator,
      createProcessingInstruction,
      createTextNode,
      createTreeWalker,

      get currentScript() {
        return currentScript.get();
      },

      get defaultView() {
        return global;
      },

      get documentElement() {
        return this.querySelector('html');
      },

      get documentURI() {
        return $document.documentURI;
      },

      get domain() {
        return $document.domain;
      },

      getElementsByTagName(name) {
        return this.querySelectorAll(name);
      },

      get head() {
        return this.querySelector('head');
      },

      get hidden() {
        return $document.hidden;
      },

      importNode,

      get readyState() {
        return $document.readyState;
      },

      get title() {
        return this.querySelector('title').textContent;
      },

      set title(value) {
        this.querySelector('title').textContent = value;
      },

      get URL() {
        return $document.URL;
      },

      get visibilityState() {
        return $document.visibilityState;
      }
    };

    // events: on*
    // TODO 返回 false 需要阻止默认行为、冒泡
    keys($parent.Document.prototype)
      .filter(name => /^on[\w\W]+$/.test(name))
      .forEach(name => {
        defineProperty(properties, name, {
          enumerable: true,
          configurable: true,
          get() {
            const cache = ONEVENT_CACHE.get(this);
            return (cache && cache[name]) || null;
          },
          set(value) {
            const type = name.replace('on', '');
            const oldValue = this[name];

            if (!ONEVENT_CACHE.has(this)) {
              ONEVENT_CACHE.set(this, {});
            }

            if (oldValue) {
              this.removeEventListener(type, oldValue);
            }

            this.addEventListener(type, value);
            ONEVENT_CACHE.get(this)[name] = value;
          }
        });
      });

    return properties;
  }

  function Element({
    customElements,
    events,
    langUtils: { from },
    symbols: { prefix },
    SandboxSecurityError,
    sanitizer,
    toNativeAny,
    toNativeObject,
    toVirtualAny,
    toVirtualNodeCreater,
    toVirtualObject,
    windowView: $windowView
  }) {
    const getProperty = (target, name) => toNativeObject(target)[name];

    const toVirtualAttrCreater = (method, params) =>
      function() {
        const [name, value] = params(arguments);
        const $params = from(arguments).map(param => toNativeAny(param));
        const $target = toNativeObject(this);
        const oldValue = $target.getAttribute(name);
        const nodeName = $target.nodeName;

        if (
          !sanitizer.isValidAttribute(nodeName, name, String(value)) ||
          name.indexOf(prefix) === 0 ||
          String(value).indexOf(prefix) === 0 ||
          (oldValue && oldValue.indexOf(prefix) === 0)
        ) {
          throw new SandboxSecurityError(
            `Forbidden: attribute [${name}=${JSON.stringify(value)}]`
          );
        }

        const $result = $target[method](...$params);

        const elemName = $target.getAttribute('is') || $target.localName;
        const newValue = $target.getAttribute(name);
        if (
          customElements.get(elemName) &&
          customElements.get(elemName).observedAttributes.includes(name) &&
          this.attributeChangedCallback &&
          (oldValue !== null || newValue !== null)
        ) {
          this.attributeChangedCallback(name, oldValue, newValue);
        }

        // toggleAttribute 有返回值
        return toVirtualAny($result);
      };

    const transformRect = DOMRectInstance => {
      const $windowViewRect = $windowView.getBoundingClientRect();
      DOMRectInstance.x -= $windowViewRect.x;
      DOMRectInstance.y -= $windowViewRect.y;
      return DOMRectInstance;
    };

    const dispatchmutation = (newNodes, oldNodes) => {
      events.dispatch('mutation', {
        newNodes,
        oldNodes
      });
    };

    return {
      get className() {
        return getProperty(this, 'className');
      },

      set className(value) {
        this.setAttribute('class', value);
      },

      set innerHTML(value) {
        const $target = toNativeObject(this);
        const isConnected = $target.isConnected;
        const $node = sanitizer.sanitize(value);
        const oldNodes = from($target.childNodes);
        const newNodes = from($node.childNodes);

        while ($target.firstChild) {
          $target.removeChild($target.firstChild);
        }

        if ($target.nodeName.toLowerCase() === 'template') {
          $target.content.appendChild($node);
        } else {
          $target.appendChild($node);
        }

        if (isConnected) {
          dispatchmutation(newNodes, oldNodes);
        }
      },

      get innerHTML() {
        return getProperty(this, 'innerHTML');
      },

      set outerHTML(value) {
        const $target = toNativeObject(this);
        const isConnected = $target.isConnected;
        const $node = sanitizer.sanitize(value);
        const oldNodes = [$target];
        const newNodes = from($node.childNodes);
        $target.parentNode.replaceChild($node, $target);

        if (isConnected) {
          dispatchmutation(newNodes, oldNodes);
        }
      },

      get outerHTML() {
        return getProperty(this, 'outerHTML');
      },

      insertAdjacentHTML(position, value) {
        const $target = toNativeObject(this);
        const isConnected = $target.isConnected;
        const $node = sanitizer.sanitize(value);
        const newNodes = from($node.childNodes);

        switch (position.toLowerCase()) {
          case 'beforebegin':
            $target.parentNode.insertBefore($node, $target);
            break;
          case 'afterbegin':
            $target.insertBefore($node, $target.firstChild);
            break;
          case 'beforeend':
            $target.appendChild($node);
            break;
          case 'afterend':
            $target.parentNode.insertBefore($node, $target.nextElementSibling);
            break;
          default:
            throw new TypeError(`invalid parameter '${position}'`);
        }

        if (isConnected) {
          dispatchmutation(newNodes, []);
        }
      },

      insertAdjacentElement: toVirtualNodeCreater(
        'insertAdjacentElement',
        p => [p[1]],
        p => (p[1].isConnected ? [p[1]] : [])
      ),

      before: toVirtualNodeCreater(
        'before',
        p => p,
        p => p.filter(n => n.isConnected)
      ),

      append: toVirtualNodeCreater(
        'append',
        p => p,
        p => p.filter(n => n.isConnected)
      ),

      after: toVirtualNodeCreater(
        'after',
        p => p,
        p => p.filter(n => n.isConnected)
      ),

      remove: toVirtualNodeCreater(
        'remove',
        () => [],
        (_, t) => (t.isConnected ? [t] : [])
      ),

      getBoundingClientRect() {
        const $target = toNativeObject(this);
        const $elementRect = $target.getBoundingClientRect();
        return toVirtualObject(transformRect($elementRect));
      },

      getClientRects() {
        const $target = toNativeObject(this);
        const $elementRectList = $target.getClientRects();
        for (let i = 0; i < $elementRectList.length; i++) {
          transformRect($elementRectList[i]);
        }
        return toVirtualObject($elementRectList);
      },

      removeAttribute: toVirtualAttrCreater('removeAttribute', p => [p[0], '']),
      removeAttributeNS: toVirtualAttrCreater('removeAttributeNS', p => [
        p[1],
        ''
      ]),
      removeAttributeNode: toVirtualAttrCreater('removeAttributeNode', p => [
        p[0].name,
        ''
      ]),
      setAttribute: toVirtualAttrCreater('setAttribute', p => p),
      setAttributeNS: toVirtualAttrCreater('setAttributeNS', p => [p[1], p[2]]),
      setAttributeNode: toVirtualAttrCreater('setAttributeNode', p => [
        p[0].name,
        p[0].value
      ]),
      setAttributeNodeNS: toVirtualAttrCreater('setAttributeNodeNS', p => [
        p[0].name,
        p[0].value
      ]),
      toggleAttribute: toVirtualAttrCreater('toggleAttribute', p => [p[0], ''])
    };
  }

  function Event$1({
    documentView: $documentView,
    global,
    parent: $parent,
    toNativeObject,
    toVirtualObject
  }) {
    return {
      composedPath() {
        const $target = toNativeObject(this);
        const $result = $target.composedPath();
        return $result
          .filter(
            $item =>
              $item === $parent ||
              ($item instanceof $parent.Node && $documentView.contains($item))
          )
          .map($item => ($item === $parent ? global : toVirtualObject($item)));
      }
    };
  }

  function FocusEvent({ global, toNativeObject, toVirtualAny }) {
    return {
      get relatedTarget() {
        const $relatedTarget = toNativeObject(this).relatedTarget;
        return $relatedTarget instanceof global.Object
          ? toVirtualAny($relatedTarget)
          : null;
      }
    };
  }

  function HTMLLinkElement({
    cspValidation,
    cssStyleSheetFilter,
    global,
    parent: $parent,
    symbols: {
      attributeChangedCallback,
      connectedCallback,
      disabled,
      observedAttributes,
      statics
    },
    toNativeObject
  }) {
    function tryAutoLoad(node) {
      if (!node.isConnected || node.rel !== 'stylesheet' || !node.href) {
        return;
      }

      const $target = toNativeObject(node);

      // TODO 逻辑迁移到 installHooks 中
      if (!cspValidation('style-src', $target.href, 'warn')) {
        $target.setAttribute('type', disabled);
      }

      // 不支持跨域的 stylesheet 访问 cssRules 会报安全错误
      // https://drafts.csswg.org/cssom/#dom-cssstylesheet-cssrules
      function isOriginCleanFlagSet() {
        try {
          return !!$target.sheet.cssRules;
        } catch (e) {
          return false;
        }
      }

      function callback() {
        if (isOriginCleanFlagSet()) {
          cssStyleSheetFilter($target.sheet);
          node.dispatchEvent(new global.Event('load'));
        } else {
          $target.setAttribute('type', disabled);
          node.dispatchEvent(new global.Event('error'));
          $parent.console.error(
            `Access to stylesheet at '${$target.href}' from origin '${global.location.origin}' has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header is present on the requested resource.`
          );
        }
      }

      $target.addEventListener('load', callback);
      $target.addEventListener('error', callback);
    }

    return {
      [connectedCallback]() {
        tryAutoLoad(this);
      },

      [attributeChangedCallback]() {
        tryAutoLoad(this);
      },

      [statics]: {
        get [observedAttributes]() {
          return ['href'];
        }
      }
    };
  }

  function HTMLScriptElement({
    browserUtils: { scriptSourceLoader, queueMicrotask },
    cspValidation,
    currentNativeObject,
    currentScript,
    evaluate,
    global,
    langUtils: { isNull },
    parent: $parent,
    SandboxSecurityError,
    sanitizer,
    symbols: {
      attributeChangedCallback,
      connectedCallback,
      initializedCallback,
      observedAttributes,
      scriptType,
      statics
    },
    toNativeObject
  }) {
    const $URL = $parent.URL;
    const WEBSANDBOX_SCRIPT_MIME = scriptType;

    function attrSecurityCheck($target, name, value) {
      if (!sanitizer.isValidAttribute($target.nodeName, name, value)) {
        throw new SandboxSecurityError(
          `Forbidden: attribute [${name}=${JSON.stringify(value)}]`
        );
      }
    }

    function execScript(source, element = null, context = {}) {
      currentScript.set(element);
      try {
        evaluate(source, context);
      } catch (error) {
        // 运行时的全局错误
        // @see https://developer.mozilla.org/en-US/docs/Web/API/GlobalEventHandlers/onerror
        queueMicrotask(() => {
          // 向主文档抛全局错误
          throw error;
        });
      }
      currentScript.set(null);
    }

    function tryAutoLoad(node) {
      if (!node.isConnected) {
        return;
      }

      const $target = toNativeObject(node);
      // 仅允许沙箱化标记的脚本运行
      if ($target.getAttribute('type') !== WEBSANDBOX_SCRIPT_MIME) {
        return;
      }

      if (node.src) {
        // TODO 逻辑迁移到 installHooks 中
        if (cspValidation('script-src', node.src, 'warn')) {
          // TODO 使用 const Event = toVirtualClass($parent.Event);
          scriptSourceLoader(node.src).then(
            source => {
              execScript(source, node);
              node.dispatchEvent(new global.Event('load'));
            },
            () => {
              node.dispatchEvent(new global.Event('error'));
            }
          );
        }
      } else if (node.textContent) {
        execScript(node.textContent, node);
      }
    }

    return {
      [initializedCallback]() {
        // <security> 至关重要的安全措施：阻止 script 标签直接运行
        currentNativeObject.get().setAttribute('type', WEBSANDBOX_SCRIPT_MIME);
        return this;
      },

      get src() {
        const $target = toNativeObject(this);
        const value = $target.getAttribute('src');
        return isNull(value) ? '' : new $URL(value, this.baseURI).href;
      },

      set src(value) {
        const $target = toNativeObject(this);
        attrSecurityCheck($target, 'src', value);
        $target.setAttribute('src', value);
      },

      get type() {
        const $target = toNativeObject(this);
        const value = $target.getAttribute('type');
        return isNull(value) ? '' : value;
      },

      set type(value) {
        const $target = toNativeObject(this);
        $target.setAttribute('type', value);
      },

      [connectedCallback]() {
        tryAutoLoad(this);
      },

      [attributeChangedCallback]() {
        tryAutoLoad(this);
      },

      [statics]: {
        get [observedAttributes]() {
          return ['src'];
        }
      }
    };
  }

  function HTMLStyleElement({
    toNativeObject,
    symbols: { connectedCallback },
    cssStyleSheetFilter
  }) {
    return {
      [connectedCallback]() {
        const $target = toNativeObject(this);
        const $sheet = $target.sheet;
        cssStyleSheetFilter($sheet);
      }
    };
  }

  function MouseEvent({
    parent: $parent,
    toNativeObject,
    windowView: $windowView
  }) {
    const selfCreated = event => {
      return event.view !== $parent;
    };

    return {
      get clientX() {
        const $target = toNativeObject(this);
        if (!selfCreated($target)) {
          const $windowRect = $windowView.getBoundingClientRect();
          return $target.clientX - $windowRect.x;
        }

        return $target.clientX;
      },

      get clientY() {
        const $target = toNativeObject(this);
        if (!selfCreated($target)) {
          const $windowRect = $windowView.getBoundingClientRect();
          return $target.clientY - $windowRect.y;
        }

        return $target.clientY;
      },

      get x() {
        return this.clientX;
      },

      get y() {
        return this.clientY;
      },

      get pageX() {
        return $windowView.scrollLeft + this.clientX;
      },

      get pageY() {
        return $windowView.scrollTop + this.clientY;
      }
    };
  }

  function Node$1({
    global,
    parent: $parent,
    toNativeObject,
    toVirtualNodeCreater
  }) {
    const $document = $parent.document;

    return {
      get ownerDocument() {
        const doc = global.document;
        if (doc === this) {
          return null;
        }
        return doc;
      },

      get nodeName() {
        const doc = global.document;
        const $target = doc === this ? $document : toNativeObject(this);
        return $target.nodeName;
      },

      get nodeType() {
        const doc = global.document;
        const $target = doc === this ? $document : toNativeObject(this);
        return $target.nodeType;
      },

      appendChild: toVirtualNodeCreater(
        'appendChild',
        p => [p[0]],
        p => (p[0].isConnected ? [p[0]] : [])
      ),

      insertBefore: toVirtualNodeCreater(
        'insertBefore',
        p => [p[0]],
        p => (p[0].isConnected ? [p[0]] : [])
      ),

      replaceChild: toVirtualNodeCreater(
        'replaceChild',
        p => [p[0]],
        p => [p[1]]
      ),

      removeChild: toVirtualNodeCreater(
        'removeChild',
        () => [],
        p => [p[0]]
      )
    };
  }

  function ShadowRoot({
    events,
    langUtils: { from },
    sanitizer,
    toNativeAny,
    toNativeObject,
    toVirtualAny
  }) {
    return {
      get adoptedStyleSheets() {
        const $target = toNativeObject(this);
        return toVirtualAny($target.adoptedStyleSheets);
      },

      set adoptedStyleSheets(value) {
        const $target = toNativeObject(this);
        const $list = toNativeAny(value).map(item => toNativeAny(item));
        $target.adoptedStyleSheets = $list;
      },

      get innerHTML() {
        return toNativeObject(this).innerHTML;
      },

      set innerHTML(value) {
        const $target = toNativeObject(this);
        const $node = sanitizer.sanitize(value);

        const isConnected = $target.isConnected;
        const oldNodes = from($target.childNodes);
        const newNodes = from($node.childNodes);

        while ($target.firstChild) {
          $target.removeChild($target.firstChild);
        }

        $target.appendChild($node);

        if (isConnected) {
          events.dispatch('mutation', {
            newNodes,
            oldNodes
          });
        }
      }
    };
  }

  // TODO storage events
  function Storage({
    currentNativeObject,
    id,
    langUtils: { inherits, isString, keys },
    symbols: { prefix, initializedCallback },
    toNativeObject,
    toVirtualObject
  }) {
    const NAMESPACES = `${prefix}${id}.`;
    const getNativeKeys = $localStorage => {
      return keys($localStorage).filter(key => key.indexOf(NAMESPACES) === 0);
    };
    return {
      [initializedCallback]() {
        return inherits(
          this,
          new Proxy(currentNativeObject.get(), {
            get($target, property) {
              const target = toVirtualObject($target);

              return isString(property) ? target.getItem(property) : undefined;
            },

            set($target, property, value) {
              const target = toVirtualObject($target);

              if (isString(property)) {
                target.setItem(property, value);
                return true;
              }

              return false;
            },

            deleteProperty($target, property) {
              const target = toVirtualObject($target);

              if (isString(property)) {
                target.removeItem(property);
                return true;
              }

              return false;
            }
          })
        );
      },

      get length() {
        return getNativeKeys(toNativeObject(this)).length;
      },

      key(index) {
        return getNativeKeys(toNativeObject(this)).map(key =>
          key.replace(NAMESPACES, '')
        )[index];
      },

      getItem(key) {
        return toNativeObject(this).getItem(`${NAMESPACES}${key}`);
      },

      setItem(key, value) {
        return toNativeObject(this).setItem(`${NAMESPACES}${key}`, value);
      },

      removeItem(key) {
        return toNativeObject(this).removeItem(`${NAMESPACES}${key}`);
      },

      clear() {
        const $localStorage = toNativeObject(this);
        getNativeKeys($localStorage).forEach(key =>
          $localStorage.removeItem(key)
        );
      }
    };
  }

  function Touch({ toNativeObject, windowView: $windowView }) {
    return {
      get clientX() {
        const $target = toNativeObject(this);
        const $boundingClientRect = $windowView.getBoundingClientRect();
        return $target.clientX - $boundingClientRect.x;
      },

      get clientY() {
        const $target = toNativeObject(this);
        const $boundingClientRect = $windowView.getBoundingClientRect();
        return $target.clientY - $boundingClientRect.y;
      },

      get pageX() {
        return $windowView.scrollLeft + this.clientX;
      },

      get pageY() {
        return $windowView.scrollTop + this.clientY;
      }
    };
  }

  var traps = /*#__PURE__*/Object.freeze({
    __proto__: null,
    CSSStyleSheet: CSSStyleSheet,
    CustomElementRegistry: CustomElementRegistry,
    Document: Document,
    Element: Element,
    Event: Event$1,
    FocusEvent: FocusEvent,
    HTMLLinkElement: HTMLLinkElement,
    HTMLScriptElement: HTMLScriptElement,
    HTMLStyleElement: HTMLStyleElement,
    MouseEvent: MouseEvent,
    Node: Node$1,
    ShadowRoot: ShadowRoot,
    Storage: Storage,
    Touch: Touch
  });

  /* global window */
  const filterPropertys = (target, regexp = /^(on)[\w]+/) =>
    Object.keys(
      typeof target === 'string' ? window[target].prototype : target
    ).filter(name => regexp.test(name));

  const toStars = list =>
    list.reduce((accumulator, name) => {
      accumulator[name] = '*';
      return accumulator;
    }, {});

  var permissions = {
    allowInterfaces: {
      // 'AbortController': '*',
      // 'AbortSignal': '*',
      // 'AbsoluteOrientationSensor': '*',
      // 'Accelerometer': '*',
      AggregateError: '*',
      // 'alert': '*',
      AnalyserNode: '*',
      Animation: '*',
      AnimationEffect: '*',
      AnimationEvent: '*',
      AnimationPlaybackEvent: '*',
      AnimationTimeline: '*',
      atob: '*',
      // 'Atomics': '*', // from realms-shim
      Attr: '*',
      Audio: '*',
      AudioBuffer: '*',
      AudioBufferSourceNode: '*',
      AudioContext: '*',
      AudioDestinationNode: '*',
      AudioListener: '*',
      AudioNode: '*',
      AudioParam: '*',
      AudioParamMap: '*',
      AudioProcessingEvent: '*',
      AudioScheduledSourceNode: '*',
      // 'AudioWorklet': '*',
      // 'AudioWorkletNode': '*',
      // 'AuthenticatorAssertionResponse': '*',
      // 'AuthenticatorAttestationResponse': '*',
      // 'AuthenticatorResponse': '*',
      // 'BackgroundFetchManager': '*',
      // 'BackgroundFetchRecord': '*',
      // 'BackgroundFetchRegistration': '*',
      // 'BarcodeDetector': '*',
      // 'BarProp': '*',
      BaseAudioContext: '*',
      // 'BatteryManager': '*',
      // 'BeforeInstallPromptEvent': '*',
      BeforeUnloadEvent: '*',
      // 'BigInt': '*',
      // 'BigInt64Array': '*',
      // 'BigUint64Array': '*',
      // 'BiquadFilterNode': '*',
      Blob: '*',
      BlobEvent: '*',
      // 'Bluetooth': '*',
      // 'BluetoothCharacteristicProperties': '*',
      // 'BluetoothDevice': '*',
      // 'BluetoothRemoteGATTCharacteristic': '*',
      // 'BluetoothRemoteGATTDescriptor': '*',
      // 'BluetoothRemoteGATTServer': '*',
      // 'BluetoothRemoteGATTService': '*',
      // 'BluetoothUUID': '*',
      blur: '*',
      // 'BroadcastChannel': '*',
      btoa: '*',
      ByteLengthQueuingStrategy: '*',
      // 'Cache': '*',
      // 'caches': '*',
      // 'CacheStorage': '*',
      cancelAnimationFrame: '*',
      // 'cancelIdleCallback': '*',
      CanvasCaptureMediaStreamTrack: '*',
      CanvasGradient: '*',
      CanvasPattern: '*',
      CanvasRenderingContext2D: '*',
      // 'captureEvents': '*', // Non-standard
      CDATASection: '*',
      ChannelMergerNode: '*',
      ChannelSplitterNode: '*',
      CharacterData: '*',
      // 'chrome': ['app', 'csi', 'loadTimes'],
      clearInterval: '*',
      clearTimeout: '*',
      // 'clientInformation': '*',
      Clipboard: '*',
      ClipboardEvent: '*',
      ClipboardItem: '*',
      close: '*',
      closed: '*',
      // 'CloseEvent': '*',
      Comment: '*',
      CompositionEvent: '*',
      CompressionStream: '*',
      // 'confirm': '*',
      console: '*',
      ConstantSourceNode: '*',
      ConvolverNode: '*',
      // 'CookieChangeEvent': '*',
      // 'cookieStore': '*',
      // 'CookieStore': '*',
      // 'CookieStoreManager': '*',
      CountQueuingStrategy: '*',
      createImageBitmap: '*',
      // 'Credential': '*',
      // 'CredentialsContainer': '*',
      // 'crossOriginIsolated': '*',
      // 'Crypto': '*',
      // 'crypto': '*',
      // 'CryptoKey': '*',
      CSS: '*',
      CSS2Properties: '*', // firefox 84.0
      CSSAnimation: '*',
      CSSConditionRule: '*',
      CSSFontFaceRule: '*',
      CSSGroupingRule: '*',
      CSSImageValue: '*',
      CSSImportRule: '*',
      CSSKeyframeRule: '*',
      CSSKeyframesRule: '*',
      CSSKeywordValue: '*',
      CSSMathInvert: '*',
      CSSMathMax: '*',
      CSSMathMin: '*',
      CSSMathNegate: '*',
      CSSMathProduct: '*',
      CSSMathSum: '*',
      CSSMathValue: '*',
      CSSMatrixComponent: '*',
      CSSMediaRule: '*',
      CSSNamespaceRule: '*',
      CSSNumericArray: '*',
      CSSNumericValue: '*',
      CSSPageRule: '*',
      CSSPerspective: '*',
      CSSPositionValue: '*',
      CSSPropertyRule: '*',
      CSSRotate: '*',
      CSSRule: '*',
      CSSRuleList: '*',
      CSSScale: '*',
      CSSSkew: '*',
      CSSSkewX: '*',
      CSSSkewY: '*',
      CSSStyleDeclaration: '*',
      CSSStyleRule: '*',
      CSSStyleSheet: '*',
      CSSStyleValue: '*',
      CSSSupportsRule: '*',
      CSSTransformComponent: '*',
      CSSTransformValue: '*',
      CSSTransition: '*',
      CSSTranslate: '*',
      CSSUnitValue: '*',
      CSSUnparsedValue: '*',
      CSSVariableReferenceValue: '*',
      CustomElementRegistry: '*',
      customElements: '*',
      CustomEvent: '*',
      DataTransfer: '*',
      DataTransferItem: '*',
      DataTransferItemList: '*',
      // 'DecompressionStream': '*',
      // 'defaultStatus': '*',
      // 'defaultstatus': '*',
      DelayNode: '*',
      DeviceMotionEvent: '*',
      DeviceMotionEventAcceleration: '*',
      DeviceMotionEventRotationRate: '*',
      DeviceOrientationEvent: '*',
      devicePixelRatio: '*',
      Document: [
        'activeElement',
        'adoptedStyleSheets',
        'adoptNode',
        // 'alinkColor',
        // 'all',
        // 'anchors',
        // 'append',
        // 'applets',
        // 'bgColor',
        'body',
        // 'captureEvents',
        // 'caretRangeFromPoint',
        'characterSet',
        // 'charset',
        'childElementCount',
        'children',
        // 'clear',
        // 'close',
        // 'compatMode',
        'contentType',
        // 'cookie',
        'createAttribute',
        'createAttributeNS',
        'createCDATASection',
        'createComment',
        'createDocumentFragment',
        'createElement',
        'createElementNS',
        'createEvent',
        // 'createExpression',
        'createNodeIterator',
        // 'createNSResolver',
        'createProcessingInstruction',
        // 'createRange',
        'createTextNode',
        'createTreeWalker',
        'currentScript',
        'defaultView',
        // 'designMode',
        // 'dir',
        // 'doctype',
        'documentElement',
        'documentURI',
        'domain',
        // 'elementFromPoint',
        // 'elementsFromPoint',
        // 'embeds',
        // 'evaluate',
        // 'execCommand',
        // 'exitFullscreen',
        // 'exitPictureInPicture',
        // 'exitPointerLock',
        // 'featurePolicy',
        // 'fgColor',
        'firstElementChild',
        // 'fonts',
        // 'forms',
        // 'fragmentDirective',
        // 'fullscreen',
        // 'fullscreenElement',
        // 'fullscreenEnabled',
        'getAnimations',
        'getElementById',
        'getElementsByClassName',
        'getElementsByName',
        'getElementsByTagName',
        'getElementsByTagNameNS',
        // 'getSelection',
        // 'hasFocus',
        'head',
        'hidden',
        // 'images',
        // 'implementation',
        'importNode',
        // 'inputEncoding',
        'lastElementChild',
        // 'lastModified',
        // 'linkColor',
        // 'links',
        ...filterPropertys('Document'),
        // 'open',
        // 'pictureInPictureElement',
        // 'pictureInPictureEnabled',
        // 'plugins',
        // 'pointerLockElement',
        // 'prepend',
        // 'queryCommandEnabled',
        // 'queryCommandIndeterm',
        // 'queryCommandState',
        // 'queryCommandSupported',
        // 'queryCommandValue',
        'querySelector',
        'querySelectorAll',
        'readyState',
        // 'referrer',
        // 'releaseEvents',
        // 'replaceChildren',
        // 'rootElement',
        // 'scripts',
        // 'scrollingElement',
        'styleSheets',
        // 'timeline',
        'title',
        'URL',
        'visibilityState'
        // 'vlinkColor',
        // 'wasDiscarded',
        // 'write',
        // 'writeln',
        // 'xmlEncoding',
        // 'xmlStandalone',
        // 'xmlVersion'
      ],
      DocumentFragment: [
        'append',
        'childElementCount',
        'children',
        'firstElementChild',
        'getElementById',
        'lastElementChild',
        'prepend',
        'querySelector',
        'querySelectorAll',
        'replaceChildren'
      ],
      DocumentTimeline: '*',
      // 'DocumentType': '*',
      DOMError: '*',
      DOMException: '*',
      // 'DOMImplementation': '*',
      DOMMatrix: '*',
      DOMMatrixReadOnly: '*',
      // 'DOMParser': '*',
      DOMPoint: '*',
      DOMPointReadOnly: '*',
      DOMQuad: '*',
      DOMRect: '*',
      DOMRectList: '*',
      DOMRectReadOnly: '*',
      DOMStringList: '*',
      DOMStringMap: '*',
      DOMTokenList: '*',
      DragEvent: '*',
      DynamicsCompressorNode: '*',
      Element: [
        'after',
        'animate',
        'append',
        // 'assignedSlot',
        'attachShadow',
        'attributes',
        'attributeStyleMap',
        'before',
        'childElementCount',
        'children',
        'classList',
        'className',
        'clientHeight',
        'clientLeft',
        'clientTop',
        'clientWidth',
        'closest',
        'computedStyleMap',
        // 'elementTiming',
        'firstElementChild',
        'getAnimations',
        'getAttribute',
        'getAttributeNames',
        'getAttributeNode',
        'getAttributeNodeNS',
        'getAttributeNS',
        'getBoundingClientRect',
        'getClientRects',
        'getElementsByClassName',
        'getElementsByTagName',
        'getElementsByTagNameNS',
        'hasAttribute',
        'hasAttributeNS',
        'hasAttributes',
        // 'hasPointerCapture',
        'id',
        'innerHTML',
        'insertAdjacentElement',
        'insertAdjacentHTML',
        'insertAdjacentText',
        'lastElementChild',
        'localName',
        'matches',
        'namespaceURI',
        'nextElementSibling',
        'outerHTML',
        'part',
        'prefix',
        // 'prepend',
        'previousElementSibling',
        'querySelector',
        'querySelectorAll',
        // 'releasePointerCapture',
        'remove',
        'removeAttribute',
        'removeAttributeNode',
        'removeAttributeNS',
        // 'replaceChildren',
        // 'replaceWith',
        // 'requestFullscreen',
        // 'requestPointerLock',
        'scroll',
        'scrollBy',
        'scrollHeight',
        'scrollIntoView',
        // 'scrollIntoViewIfNeeded',
        'scrollLeft',
        'scrollTo',
        'scrollTop',
        'scrollWidth',
        'setAttribute',
        'setAttributeNode',
        'setAttributeNodeNS',
        'setAttributeNS',
        // 'setPointerCapture',
        'shadowRoot',
        // 'slot',
        'tagName',
        'toggleAttribute',
        ...filterPropertys('Element', /^(aria|on)[\w]+/)
      ],
      ElementInternals: '*',
      ErrorEvent: '*',
      Event: [
        // 'AT_TARGET',
        'bubbles',
        // 'BUBBLING_PHASE',
        'cancelable',
        // 'cancelBubble',
        // 'CAPTURING_PHASE',
        // 'composed',
        // 'composedPath',
        'currentTarget',
        'defaultPrevented',
        'eventPhase',
        'initEvent',
        // 'NONE',
        // 'path',
        'preventDefault',
        // 'returnValue',
        // 'srcElement',
        'stopImmediatePropagation',
        'stopPropagation',
        'target',
        'timeStamp',
        'type'
      ],
      // 'EventCounts': '*',
      // 'EventSource': '*',
      EventTarget: ['addEventListener', 'dispatchEvent', 'removeEventListener'],
      // 'External': '*',
      // 'external': '*',
      // 'FeaturePolicy': '*',
      // 'FederatedCredential': '*',
      fetch: '*',
      // 'File': '*',
      // 'FileList': '*',
      // 'FileReader': '*',
      // 'FileSystemDirectoryHandle': '*',
      // 'FileSystemFileHandle': '*',
      // 'FileSystemHandle': '*',
      // 'FileSystemWritableFileStream': '*',
      // 'FinalizationRegistry': '*',
      // 'find': '*',
      focus: '*',
      FocusEvent: '*',
      FontFace: '*',
      FontFaceSetLoadEvent: '*',
      // 'FormData': '*',
      // 'FormDataEvent': '*',
      // 'FragmentDirective': '*',
      // 'frameElement': '*',
      GainNode: '*',
      // 'Gamepad': '*',
      // 'GamepadButton': '*',
      // 'GamepadEvent': '*',
      // 'GamepadHapticActuator': '*',
      // 'Geolocation': '*',
      // 'GeolocationCoordinates': '*',
      // 'GeolocationPosition': '*',
      // 'GeolocationPositionError': '*',
      getComputedStyle: '*',
      // 'getSelection': '*',
      // 'Gyroscope': '*',
      HashChangeEvent: '*',
      // 'Headers': '*',
      // 'History': '*',
      // 'history': '*',
      HTMLAllCollection: '*',
      HTMLAnchorElement: '*',
      HTMLAreaElement: '*',
      HTMLAudioElement: '*',
      // 'HTMLBaseElement': '*',
      HTMLQuoteElement: '*',
      HTMLBodyElement: filterPropertys('HTMLBodyElement'),
      HTMLBRElement: '*',
      HTMLButtonElement: '*',
      HTMLCanvasElement: '*',
      HTMLCollection: '*',
      HTMLTableCaptionElement: '*',
      HTMLTableColElement: '*',
      // 'HTMLContentElement': '*',
      HTMLDataElement: '*',
      HTMLDataListElement: '*',
      HTMLDocument: '*',
      HTMLElement: [
        'accessKey',
        // 'attachInternals',
        // 'autocapitalize',
        'autofocus',
        'blur',
        'click',
        // 'contentEditable',
        'dataset',
        'dir',
        'draggable',
        // 'enterKeyHint',
        'focus',
        'hidden',
        'innerText',
        // 'inputMode',
        // 'isContentEditable',
        'lang',
        // 'nonce',
        'offsetHeight',
        'offsetLeft',
        'offsetParent',
        'offsetTop',
        'offsetWidth',
        ...filterPropertys('HTMLElement'),
        // 'outerText',
        'spellcheck',
        'style',
        'tabIndex',
        'title'
        // 'translate'
      ],
      HTMLModElement: '*',
      HTMLDetailsElement: '*',
      HTMLDialogElement: [
        'close',
        'open',
        'returnValue',
        'show'
        // 'showModal'
      ],
      HTMLDivElement: '*',
      // 'HTMLDirectoryElement': '*',
      HTMLDListElement: '*',
      // 'HTMLEmbedElement': '*',
      HTMLFieldSetElement: '*',
      // 'HTMLFontElement': '*',
      // 'HTMLFormControlsCollection': '*',
      HTMLFormElement: '*',
      // 'HTMLFrameElement': '*',
      // 'HTMLFrameSetElement': '*',
      HTMLHeadingElement: '*',
      HTMLHeadElement: '*',
      HTMLHRElement: '*',
      HTMLHtmlElement: '*',
      // 'HTMLIFrameElement': '*',
      HTMLImageElement: '*',
      HTMLInputElement: '*',
      HTMLLabelElement: '*',
      HTMLLegendElement: '*',
      HTMLLIElement: '*',
      HTMLLinkElement: '*',
      HTMLMapElement: '*',
      // 'HTMLMarqueeElement': '*',
      HTMLMediaElement: '*',
      // 'HTMLMetaElement': '*',
      HTMLMeterElement: '*',
      HTMLMenuElement: '*',
      // 'HTMLObjectElement': '*',
      HTMLOListElement: '*',
      HTMLOptGroupElement: '*',
      HTMLOptionElement: '*',
      HTMLOptionsCollection: '*',
      HTMLOutputElement: '*',
      HTMLParagraphElement: '*',
      // 'HTMLParamElement': '*',
      HTMLPictureElement: '*',
      HTMLPreElement: '*',
      HTMLProgressElement: '*',
      HTMLScriptElement: '*',
      HTMLSelectElement: '*',
      // 'HTMLShadowElement': '*',
      HTMLSlotElement: ['name'],
      HTMLSourceElement: '*',
      HTMLSpanElement: '*',
      HTMLStyleElement: '*',
      HTMLTableElement: '*',
      HTMLTableSectionElement: '*',
      HTMLTableCellElement: '*',
      HTMLTemplateElement: '*',
      HTMLTextAreaElement: '*',
      HTMLTimeElement: '*',
      HTMLTitleElement: '*',
      HTMLTableRowElement: '*',
      HTMLTrackElement: '*',
      HTMLUListElement: '*',
      HTMLUnknownElement: '*',
      HTMLVideoElement: '*',
      WebWidgetPortalDestinations: '*', // WebSandbox 私有接口
      WebWidgetDependencies: '*', // WebSandbox 私有接口
      // WebSandbox 私有接口
      HTMLWebSandboxElement: [
        'contentDocument',
        'contentWindow',
        'csp',
        // 'debug',
        'evaluate',
        'name',
        'src',
        'text'
      ],
      // WebSandbox 私有接口
      HTMLWebWidgetElement: [
        'application',
        'bootstrap',
        'csp',
        'data',
        'importance',
        'inactive',
        'load',
        'loading',
        'mount',
        'name',
        'sandboxed',
        'slot',
        'src',
        'state',
        'status',
        'text',
        'type',
        'unload',
        'unmount',
        'update',
        'NOT_LOADED',
        'LOADING_SOURCE_CODE',
        'NOT_BOOTSTRAPPED',
        'BOOTSTRAPPING',
        'NOT_MOUNTED',
        'MOUNTING',
        'MOUNTED',
        'UPDATING',
        'UNMOUNTING',
        'UNLOADING',
        'LOAD_ERROR',
        'BOOTSTRAPP_ERROR',
        'MOUNT_ERROR',
        'UPDAT_ERROR',
        'UNMOUNT_ERROR',
        'UNLOAD_ERROR'
      ],
      // 'IDBCursor': '*',
      // 'IDBCursorWithValue': '*',
      // 'IDBDatabase': '*',
      // 'IDBFactory': '*',
      // 'IDBIndex': '*',
      // 'IDBKeyRange': '*',
      // 'IDBObjectStore': '*',
      // 'IDBOpenDBRequest': '*',
      // 'IDBRequest': '*',
      // 'IDBTransaction': '*',
      // 'IDBVersionChangeEvent': '*',
      // 'IdleDeadline': '*',
      IIRFilterNode: '*',
      Image: '*',
      ImageBitmap: '*',
      ImageBitmapRenderingContext: '*',
      ImageCapture: '*',
      ImageData: '*',
      // 'indexedDB': '*',
      // 'innerHeight': '*',
      // 'innerWidth': '*',
      // 'InputDeviceCapabilities': '*',
      // 'InputDeviceInfo': '*',
      InputEvent: '*',
      // 'IntersectionObserver': '*',
      // 'IntersectionObserverEntry': '*',
      // 'isSecureContext': '*',
      Keyboard: '*',
      KeyboardEvent: '*',
      KeyboardLayoutMap: '*',
      KeyframeEffect: '*',
      // 'LargestContentfulPaint': '*',
      // 'LayoutShift': '*',
      // 'LayoutShiftAttribution': '*',
      // 'length': '*',
      // 'LinearAccelerationSensor': '*',
      localStorage: '*',
      Location: '*',
      location: '*',
      // 'locationbar': '*',
      // 'Lock': '*',
      // 'LockManager': '*',
      matchMedia: '*',
      MediaCapabilities: '*',
      MediaDeviceInfo: '*',
      MediaDevices: '*',
      MediaElementAudioSourceNode: '*',
      // 'MediaEncryptedEvent': '*',
      MediaError: '*',
      MediaKeyMessageEvent: '*',
      MediaKeys: '*',
      MediaKeySession: '*',
      MediaKeyStatusMap: '*',
      MediaKeySystemAccess: '*',
      MediaList: '*',
      MediaMetadata: '*',
      MediaQueryList: '*',
      MediaQueryListEvent: '*',
      MediaRecorder: '*',
      MediaSession: '*',
      MediaSource: '*',
      MediaStream: '*',
      MediaStreamAudioDestinationNode: '*',
      MediaStreamAudioSourceNode: '*',
      // 'MediaStreamEvent': '*',
      MediaStreamTrack: '*',
      MediaStreamTrackEvent: '*',
      menubar: '*',
      MessageChannel: '*',
      MessageEvent: '*',
      MessagePort: '*',
      // 'MIDIAccess': '*',
      // 'MIDIConnectionEvent': '*',
      // 'MIDIInput': '*',
      // 'MIDIInputMap': '*',
      // 'MIDIMessageEvent': '*',
      // 'MIDIOutput': '*',
      // 'MIDIOutputMap': '*',
      // 'MIDIPort': '*',
      // 'MimeType': '*',
      // 'MimeTypeArray': '*',
      MouseEvent: [
        'altKey',
        'button',
        // 'buttons',
        'clientX',
        'clientY',
        'ctrlKey',
        // 'fromElement',
        // 'getModifierState',
        // 'initMouseEvent',
        // 'layerX',
        // 'layerY',
        'metaKey',
        'movementX',
        'movementY',
        'offsetX',
        'offsetY',
        'pageX',
        'pageY',
        'relatedTarget',
        // 'screenX',
        // 'screenY',
        'shiftKey',
        // 'toElement',
        'x',
        'y'
      ],
      // 'moveBy': '*',
      // 'moveTo': '*',
      // 'MutationEvent': '*',
      MutationObserver: '*',
      MutationRecord: '*',
      name: '*',
      NamedNodeMap: '*',
      NavigationPreloadManager: '*',
      Navigator: [
        // 'appCodeName',
        // 'appName',
        // 'appVersion',
        // 'bluetooth',
        // 'clearAppBadge',
        // 'clipboard',
        // 'connection',
        // 'cookieEnabled',
        // 'credentials',
        // 'deviceMemory',
        // 'doNotTrack',
        // 'geolocation',
        // 'getBattery',
        // 'getGamepads',
        // 'getInstalledRelatedApps',
        // 'getUserMedia',
        // 'hardwareConcurrency',
        // 'javaEnabled',
        // 'keyboard',
        'language',
        'languages',
        // 'locks',
        // 'maxTouchPoints',
        // 'mediaCapabilities',
        // 'mediaDevices',
        // 'mediaSession',
        // 'mimeTypes',
        // 'onLine',
        // 'permissions',
        // 'platform',
        // 'plugins',
        // 'presentation',
        // 'product',
        // 'productSub',
        // 'registerProtocolHandler',
        // 'requestMediaKeySystemAccess',
        // 'requestMIDIAccess',
        // 'scheduling',
        // 'sendBeacon',
        // 'serviceWorker',
        // 'setAppBadge',
        // 'storage',
        // 'unregisterProtocolHandler',
        // 'usb',
        // 'userActivation',
        'userAgent'
        // 'vendor',
        // 'vendorSub',
        // 'vibrate',
        // 'wakeLock',
        // 'xr'
      ],
      navigator: '*',
      // 'NetworkInformation': '*',
      Node: [
        'appendChild',
        'ATTRIBUTE_NODE',
        'baseURI',
        'CDATA_SECTION_NODE',
        'childNodes',
        'cloneNode',
        'COMMENT_NODE',
        // 'compareDocumentPosition',
        'contains',
        'DOCUMENT_FRAGMENT_NODE',
        'DOCUMENT_NODE',
        'DOCUMENT_POSITION_CONTAINED_BY',
        'DOCUMENT_POSITION_CONTAINS',
        'DOCUMENT_POSITION_DISCONNECTED',
        'DOCUMENT_POSITION_FOLLOWING',
        'DOCUMENT_POSITION_IMPLEMENTATION_SPECIFIC',
        'DOCUMENT_POSITION_PRECEDING',
        'DOCUMENT_TYPE_NODE',
        'ELEMENT_NODE',
        'ENTITY_NODE',
        'ENTITY_REFERENCE_NODE',
        'firstChild',
        'getRootNode',
        'hasChildNodes',
        'insertBefore',
        'isConnected',
        // 'isDefaultNamespace',
        'isEqualNode',
        // 'isSameNode',
        'lastChild',
        // 'lookupNamespaceURI',
        // 'lookupPrefix',
        'nextSibling',
        'nodeName',
        'nodeType',
        'nodeValue',
        'normalize',
        'NOTATION_NODE',
        'ownerDocument',
        // 'parentElement',
        'parentNode',
        'previousSibling',
        'PROCESSING_INSTRUCTION_NODE',
        'removeChild',
        'replaceChild',
        'textContent',
        'TEXT_NODE'
      ],
      NodeFilter: '*',
      NodeIterator: '*',
      NodeList: '*',
      Notification: '*',
      OfflineAudioCompletionEvent: '*',
      OfflineAudioContext: '*',
      offscreenBuffering: '*',
      OffscreenCanvas: '*',
      OffscreenCanvasRenderingContext2D: '*',
      ...toStars(filterPropertys(window)),
      // 'open': '*',
      // 'openDatabase': '*',
      // 'opener': '*',
      // 'Option': '*',
      // 'OrientationSensor': '*',
      // 'origin': '*',
      // 'OscillatorNode': '*',
      // 'outerHeight': '*',
      // 'outerWidth': '*',
      OverconstrainedError: '*',
      PageTransitionEvent: '*',
      // 'pageXOffset': '*',
      // 'pageYOffset': '*',
      // 'PannerNode': '*',
      // 'PasswordCredential': '*',
      Path2D: '*',
      // 'PaymentAddress': '*',
      // 'PaymentInstruments': '*',
      // 'PaymentManager': '*',
      // 'PaymentMethodChangeEvent': '*',
      // 'PaymentRequest': '*',
      // 'PaymentRequestUpdateEvent': '*',
      // 'PaymentResponse': '*',
      // 'Performance': '*',
      // 'performance': '*',
      // 'PerformanceElementTiming': '*',
      // 'PerformanceEntry': '*',
      // 'PerformanceEventTiming': '*',
      // 'PerformanceLongTaskTiming': '*',
      // 'PerformanceMark': '*',
      // 'PerformanceMeasure': '*',
      // 'PerformanceNavigation': '*',
      // 'PerformanceNavigationTiming': '*',
      // 'PerformanceObserver': '*',
      // 'PerformanceObserverEntryList': '*',
      // 'PerformancePaintTiming': '*',
      // 'PerformanceResourceTiming': '*',
      // 'PerformanceServerTiming': '*',
      // 'PerformanceTiming': '*',
      // 'PeriodicSyncManager': '*',
      // 'PeriodicWave': '*',
      // 'Permissions': '*',
      // 'PermissionStatus': '*',
      // 'personalbar': '*',
      // 'PictureInPictureEvent': '*',
      // 'PictureInPictureWindow': '*',
      // 'Plugin': '*',
      // 'PluginArray': '*',
      // 'PointerEvent': '*',
      // 'PopStateEvent': '*',
      // 'postMessage': '*',
      // 'Presentation': '*',
      // 'PresentationAvailability': '*',
      // 'PresentationConnection': '*',
      // 'PresentationConnectionAvailableEvent': '*',
      // 'PresentationConnectionCloseEvent': '*',
      // 'PresentationConnectionList': '*',
      // 'PresentationReceiver': '*',
      // 'PresentationRequest': '*',
      // 'print': '*',
      // 'ProcessingInstruction': '*',
      // 'ProgressEvent': '*',
      // 'PromiseRejectionEvent': '*',
      // 'prompt': '*',
      // 'PublicKeyCredential': '*',
      // 'PushManager': '*',
      // 'PushSubscription': '*',
      // 'PushSubscriptionOptions': '*',
      queueMicrotask: '*',
      RadioNodeList: '*',
      // 'Range': '*',
      // 'ReadableStream': '*',
      // 'ReadableStreamDefaultReader': '*',
      // 'RelativeOrientationSensor': '*',
      // 'releaseEvents': '*',
      // 'RemotePlayback': '*',
      // 'ReportingObserver': '*',
      // 'Request': '*',
      requestAnimationFrame: '*',
      requestIdleCallback: '*',
      // 'resizeBy': '*',
      ResizeObserver: '*',
      ResizeObserverEntry: '*',
      ResizeObserverSize: '*',
      // 'resizeTo': '*',
      // 'Response': '*',
      // 'RTCCertificate': '*',
      // 'RTCDataChannel': '*',
      // 'RTCDataChannelEvent': '*',
      // 'RTCDtlsTransport': '*',
      // 'RTCDTMFSender': '*',
      // 'RTCDTMFToneChangeEvent': '*',
      // 'RTCEncodedAudioFrame': '*',
      // 'RTCEncodedVideoFrame': '*',
      // 'RTCError': '*',
      // 'RTCErrorEvent': '*',
      // 'RTCIceCandidate': '*',
      // 'RTCIceTransport': '*',
      // 'RTCPeerConnection': '*',
      // 'RTCPeerConnectionIceErrorEvent': '*',
      // 'RTCPeerConnectionIceEvent': '*',
      // 'RTCRtpReceiver': '*',
      // 'RTCRtpSender': '*',
      // 'RTCRtpTransceiver': '*',
      // 'RTCSctpTransport': '*',
      // 'RTCSessionDescription': '*',
      // 'RTCStatsReport': '*',
      // 'RTCTrackEvent': '*',
      // 'Scheduling': '*',
      // 'Screen': '*',
      // 'screen': '*',
      // 'screenLeft': '*',
      // 'ScreenOrientation': '*',
      // 'screenTop': '*',
      // 'screenX': '*',
      // 'screenY': '*',
      // 'ScriptProcessorNode': '*',
      // 'scroll': '*',
      // 'scrollbars': '*',
      // 'scrollBy': '*',
      // 'scrollTo': '*',
      // 'scrollX': '*',
      // 'scrollY': '*',
      // 'SecurityPolicyViolationEvent': '*',
      // 'Selection': '*',
      // 'Sensor': '*',
      // 'SensorErrorEvent': '*',
      // 'ServiceWorker': '*',
      // 'ServiceWorkerContainer': '*',
      // 'ServiceWorkerRegistration': '*',
      // 'sessionStorage': '*',
      setInterval: '*',
      setTimeout: '*',
      ShadowRoot: [
        'activeElement',
        'adoptedStyleSheets',
        'delegatesFocus',
        // 'elementFromPoint',
        // 'elementsFromPoint',
        // 'fullscreenElement',
        'getAnimations',
        // 'getSelection',
        'host',
        'innerHTML',
        'mode',
        // 'pictureInPictureElement',
        // 'pointerLockElement',
        // 'slotAssignment',
        'styleSheets'
      ],
      // 'SharedArrayBuffer': '*', // from realms-shim
      // 'SharedWorker': '*',
      // 'showDirectoryPicker': '*',
      // 'showOpenFilePicker': '*',
      // 'showSaveFilePicker': '*',
      SourceBuffer: '*',
      SourceBufferList: '*',
      speechSynthesis: '*',
      SpeechSynthesisErrorEvent: '*',
      SpeechSynthesisEvent: '*',
      SpeechSynthesisUtterance: '*',
      // 'StaticRange': '*',
      // 'status': '*',
      // 'statusbar': '*',
      // 'StereoPannerNode': '*',
      // 'stop': '*',
      Storage: ['clear', 'getItem', 'key', 'length', 'removeItem', 'setItem'],
      StorageEvent: '*',
      StorageManager: '*',
      styleMedia: '*',
      StylePropertyMap: '*',
      StylePropertyMapReadOnly: '*',
      StyleSheet: '*',
      StyleSheetList: '*',
      SubmitEvent: '*',
      // 'SubtleCrypto': '*',
      // 'SVGAElement': '*',
      // 'SVGAngle': '*',
      // 'SVGAnimatedAngle': '*',
      // 'SVGAnimatedBoolean': '*',
      // 'SVGAnimatedEnumeration': '*',
      // 'SVGAnimatedInteger': '*',
      // 'SVGAnimatedLength': '*',
      // 'SVGAnimatedLengthList': '*',
      // 'SVGAnimatedNumber': '*',
      // 'SVGAnimatedNumberList': '*',
      // 'SVGAnimatedPreserveAspectRatio': '*',
      // 'SVGAnimatedRect': '*',
      // 'SVGAnimatedString': '*',
      // 'SVGAnimatedTransformList': '*',
      // 'SVGAnimateElement': '*',
      // 'SVGAnimateMotionElement': '*',
      // 'SVGAnimateTransformElement': '*',
      // 'SVGAnimationElement': '*',
      // 'SVGCircleElement': '*',
      // 'SVGClipPathElement': '*',
      // 'SVGComponentTransferFunctionElement': '*',
      // 'SVGDefsElement': '*',
      // 'SVGDescElement': '*',
      // 'SVGElement': '*',
      // 'SVGEllipseElement': '*',
      // 'SVGFEBlendElement': '*',
      // 'SVGFEColorMatrixElement': '*',
      // 'SVGFEComponentTransferElement': '*',
      // 'SVGFECompositeElement': '*',
      // 'SVGFEConvolveMatrixElement': '*',
      // 'SVGFEDiffuseLightingElement': '*',
      // 'SVGFEDisplacementMapElement': '*',
      // 'SVGFEDistantLightElement': '*',
      // 'SVGFEDropShadowElement': '*',
      // 'SVGFEFloodElement': '*',
      // 'SVGFEFuncAElement': '*',
      // 'SVGFEFuncBElement': '*',
      // 'SVGFEFuncGElement': '*',
      // 'SVGFEFuncRElement': '*',
      // 'SVGFEGaussianBlurElement': '*',
      // 'SVGFEImageElement': '*',
      // 'SVGFEMergeElement': '*',
      // 'SVGFEMergeNodeElement': '*',
      // 'SVGFEMorphologyElement': '*',
      // 'SVGFEOffsetElement': '*',
      // 'SVGFEPointLightElement': '*',
      // 'SVGFESpecularLightingElement': '*',
      // 'SVGFESpotLightElement': '*',
      // 'SVGFETileElement': '*',
      // 'SVGFETurbulenceElement': '*',
      // 'SVGFilterElement': '*',
      // 'SVGForeignObjectElement': '*',
      // 'SVGGElement': '*',
      // 'SVGGeometryElement': '*',
      // 'SVGGradientElement': '*',
      // 'SVGGraphicsElement': '*',
      // 'SVGImageElement': '*',
      // 'SVGLength': '*',
      // 'SVGLengthList': '*',
      // 'SVGLinearGradientElement': '*',
      // 'SVGLineElement': '*',
      // 'SVGMarkerElement': '*',
      // 'SVGMaskElement': '*',
      // 'SVGMatrix': '*',
      // 'SVGMetadataElement': '*',
      // 'SVGMPathElement': '*',
      // 'SVGNumber': '*',
      // 'SVGNumberList': '*',
      // 'SVGPathElement': '*',
      // 'SVGPatternElement': '*',
      // 'SVGPoint': '*',
      // 'SVGPointList': '*',
      // 'SVGPolygonElement': '*',
      // 'SVGPolylineElement': '*',
      // 'SVGPreserveAspectRatio': '*',
      // 'SVGRadialGradientElement': '*',
      // 'SVGRect': '*',
      // 'SVGRectElement': '*',
      // 'SVGScriptElement': '*',
      // 'SVGSetElement': '*',
      // 'SVGStopElement': '*',
      // 'SVGStringList': '*',
      // 'SVGStyleElement': '*',
      // 'SVGSVGElement': '*',
      // 'SVGSwitchElement': '*',
      // 'SVGSymbolElement': '*',
      // 'SVGTextContentElement': '*',
      // 'SVGTextElement': '*',
      // 'SVGTextPathElement': '*',
      // 'SVGTextPositioningElement': '*',
      // 'SVGTitleElement': '*',
      // 'SVGTransform': '*',
      // 'SVGTransformList': '*',
      // 'SVGTSpanElement': '*',
      // 'SVGUnitTypes': '*',
      // 'SVGUseElement': '*',
      // 'SVGViewElement': '*',
      // 'SyncManager': '*',
      // 'TaskAttributionTiming': '*',
      Text: [
        // 'assignedSlot',
        // 'splitText',
        'wholeText'
      ],
      TextDecoder: '*',
      TextDecoderStream: '*',
      TextEncoder: '*',
      TextEncoderStream: '*',
      TextEvent: '*',
      TextMetrics: '*',
      TextTrack: '*',
      TextTrackCue: '*',
      TextTrackCueList: '*',
      TextTrackList: '*',
      // 'TimeRanges': '*',
      // 'toolbar': '*',
      Touch: '*',
      TouchEvent: '*',
      TouchList: '*',
      TrackEvent: '*',
      TransformStream: '*',
      TransitionEvent: '*',
      TreeWalker: '*',
      TrustedHTML: '*',
      TrustedScript: '*',
      TrustedScriptURL: '*',
      TrustedTypePolicy: '*',
      TrustedTypePolicyFactory: '*',
      trustedTypes: '*',
      UIEvent: [
        'detail'
        // 'initUIEvent',
        // 'sourceCapabilities',
        // 'view',
        // 'which'
      ],
      URL: '*',
      URLSearchParams: '*',
      // 'USB': '*',
      // 'USBAlternateInterface': '*',
      // 'USBConfiguration': '*',
      // 'USBConnectionEvent': '*',
      // 'USBDevice': '*',
      // 'USBEndpoint': '*',
      // 'USBInterface': '*',
      // 'USBInTransferResult': '*',
      // 'USBIsochronousInTransferPacket': '*',
      // 'USBIsochronousInTransferResult': '*',
      // 'USBIsochronousOutTransferPacket': '*',
      // 'USBIsochronousOutTransferResult': '*',
      // 'USBOutTransferResult': '*',
      // 'UserActivation': '*',
      // 'ValidityState': '*',
      VideoPlaybackQuality: '*',
      // 'VisualViewport': '*',
      // 'visualViewport': '*',
      // 'VTTCue': '*',
      // 'WakeLock': '*',
      // 'WakeLockSentinel': '*',
      // 'WaveShaperNode': '*',
      // 'WeakRef': '*',
      // 'WebAssembly': '*',
      WebGL2RenderingContext: '*',
      WebGLActiveInfo: '*',
      WebGLBuffer: '*',
      WebGLContextEvent: '*',
      WebGLFramebuffer: '*',
      WebGLProgram: '*',
      WebGLQuery: '*',
      WebGLRenderbuffer: '*',
      WebGLRenderingContext: '*',
      WebGLSampler: '*',
      WebGLShader: '*',
      WebGLShaderPrecisionFormat: '*',
      WebGLSync: '*',
      WebGLTexture: '*',
      WebGLTransformFeedback: '*',
      WebGLUniformLocation: '*',
      WebGLVertexArrayObject: '*',
      // 'WebSocket': '*',
      WheelEvent: '*',
      Window: [
        // 'PERSISTENT',
        // 'TEMPORARY'
      ],
      // 'Worker': '*',
      // 'Worklet': '*',
      WritableStream: '*',
      WritableStreamDefaultWriter: '*',
      // 'XMLDocument': '*',
      XMLHttpRequest: '*',
      XMLHttpRequestEventTarget: '*',
      XMLHttpRequestUpload: '*'
      // 'XMLSerializer': '*',
      // 'XPathEvaluator': '*',
      // 'XPathExpression': '*',
      // 'XPathResult': '*',
      // 'XRAnchor': '*',
      // 'XRAnchorSet': '*',
      // 'XRBoundedReferenceSpace': '*',
      // 'XRDOMOverlayState': '*',
      // 'XRFrame': '*',
      // 'XRHitTestResult': '*',
      // 'XRHitTestSource': '*',
      // 'XRInputSource': '*',
      // 'XRInputSourceArray': '*',
      // 'XRInputSourceEvent': '*',
      // 'XRInputSourcesChangeEvent': '*',
      // 'XRLayer': '*',
      // 'XRPose': '*',
      // 'XRRay': '*',
      // 'XRReferenceSpace': '*',
      // 'XRReferenceSpaceEvent': '*',
      // 'XRRenderState': '*',
      // 'XRRigidTransform': '*',
      // 'XRSession': '*',
      // 'XRSessionEvent': '*',
      // 'XRSpace': '*',
      // 'XRSystem': '*',
      // 'XRTransientInputHitTestResult': '*',
      // 'XRTransientInputHitTestSource': '*',
      // 'XRView': '*',
      // 'XRViewerPose': '*',
      // 'XRViewport': '*',
      // 'XRWebGLLayer': '*',
      // 'XSLTProcessor'
    }
    // blockInterfaces: [],
    // allowElements: [],
    // blockElements: [],
    // dropElements: [],
    // allowAttributes: [],
    // dropAttributes: []
  };

  var allowLiveOwnPropertysConfig = [
    'Array',
    'AudioParamMap',
    'CSSKeyframesRule',
    'CSSNumericArray',
    'CSSRuleList',
    'CSSStyleDeclaration',
    'CSSTransformValue',
    'CSSUnparsedValue',
    'DataTransferItemList',
    'DOMRectList',
    'DOMStringList',
    'DOMTokenList',
    'EventCounts',
    'FileList',
    'FormData',
    'Headers',
    'HTMLAllCollection',
    'HTMLCollection',
    'HTMLFormControlsCollection',
    'HTMLFormElement',
    'HTMLOptionsCollection',
    'HTMLSelectElement',
    'KeyboardLayoutMap',
    'MediaKeyStatusMap',
    'MediaList',
    'MIDIInputMap',
    'MIDIOutputMap',
    'MimeTypeArray',
    'NamedNodeMap',
    'NodeList',
    'Object',
    'Plugin',
    'PluginArray',
    'Promise',
    'RadioNodeList',
    'RTCStatsReport',
    'SourceBufferList',
    'StylePropertyMap',
    'StylePropertyMapReadOnly',
    'StyleSheetList',
    'SVGLengthList',
    'SVGNumberList',
    'SVGPointList',
    'SVGStringList',
    'SVGTransformList',
    'TextTrackCueList',
    'TextTrackList',
    'TouchList',
    'XRAnchorSet',
    'XRInputSourceArray'
  ];

  const allowInterfaces = permissions.allowInterfaces;
  function toVirtualClass({
    createVirtualClass,
    currentNativeObject,
    evaluate,
    wrapError,
    global,
    injector,
    toVirtualAny,
    virtualCache,
    langUtils: {
      defineProperty,
      getOwnPropertyDescriptor,
      getOwnPropertyNames,
      getPrototypeOf,
      inherits,
      keys,
      ownKeys
    },
    parent,
    SandboxSecurityError,
    symbols: {
      attributeChangedCallback,
      connectedCallback,
      disconnectedCallback,
      initializedCallback,
      observedAttributes
    },
    toLiveVirtuaObject
  }) {
    const NativeRootClass = getPrototypeOf(Object);
    const VirtualRootClass = getPrototypeOf(global.Object);
    const internalInterfaces = new Map();

    const ignoreProperties = new Set([
      'arguments',
      'caller',
      'length',
      'name',
      'prototype'
    ]);
    const ignorePrototypes = new Set(['constructor']);
    const propertiesFilter = name => !ignoreProperties.has(name);
    const PrototypesFilter = name => !ignorePrototypes.has(name);
    const getAllFeatures = NativeClass => [
      ...getOwnPropertyNames(NativeClass).filter(propertiesFilter),
      ...getOwnPropertyNames(NativeClass.prototype || {}).filter(PrototypesFilter)
    ];

    function getAllowFeatures(name) {
      if (allowInterfaces === '*' || allowInterfaces[name] === '*') {
        return parent[name] ? getAllFeatures(parent[name]) : [];
      }
      return allowInterfaces[name];
    }

    function getTrap(name) {
      const descriptor = internalInterfaces.get(name);

      if (descriptor) {
        return descriptor;
      }

      // 按需加载，提高性能
      if (traps[name]) {
        const fn = evaluate(traps[name]);
        const descriptor = injector.resolve(fn)();

        ownKeys(descriptor).forEach(key => {
          const des = getOwnPropertyDescriptor(descriptor, key);
          keys(des).forEach(k => {
            const rawFn = des[k];
            if (typeof rawFn === 'function') {
              des[k] = wrapError(rawFn);
            }
          });
          defineProperty(descriptor, key, des);
        });

        internalInterfaces.set(name, descriptor);
        return descriptor;
      }

      return null;
    }

    const setLiveVirtuaObject = evaluate(
      (inherits, toLiveVirtuaObject, currentNativeObject) =>
        function() {
          return inherits(this, toLiveVirtuaObject(currentNativeObject.get()));
        }
    )(inherits, toLiveVirtuaObject, currentNativeObject);

    function setProperty(target, source, trap, property) {
      const trapDescriptor = trap && getOwnPropertyDescriptor(trap, property);

      if (trapDescriptor) {
        defineProperty(target, property, trapDescriptor);
      } else {
        const descriptor = getOwnPropertyDescriptor(source, property);
        if (descriptor) {
          ownKeys(descriptor).forEach(key => {
            descriptor[key] = toVirtualAny(descriptor[key]);
          });
          defineProperty(target, property, descriptor);
        } else {
          // 如果 target 等于 Document，那么 source 等于 ShadowRoot，此时的问题是：
          // 类似 querySelector 的方法不存在 source 属性中，而是来自父类 DocumentFragment，
          // 因此我们需要不断的向原型链中获取描述对象
          const parentObject = getPrototypeOf(source);
          if (parentObject) {
            setProperty(target, parentObject, trap, property);
          }
        }
      }
    }

    function importPropertys(target, source, native) {
      const allowList = getAllowFeatures(target.name);
      const trap = getTrap(target.name);

      getOwnPropertyNames(native)
        .filter(propertiesFilter)
        .filter(property => allowList.includes(property))
        .forEach(property => {
          setProperty(target, source, trap, property);
        });

      if (native.prototype) {
        getOwnPropertyNames(native.prototype)
          .filter(PrototypesFilter)
          .filter(property => allowList.includes(property))
          .forEach(property => {
            setProperty(target.prototype, source.prototype, trap, property);
          });
      }
    }

    function createVirtualClassProxy(NativeClass, importPropertysTarget) {
      if (virtualCache.has(NativeClass)) {
        return virtualCache.get(NativeClass);
      }

      if (NativeClass === NativeRootClass) {
        return VirtualRootClass;
      }

      const name = NativeClass.name;

      if (!getAllowFeatures(name)) {
        throw new SandboxSecurityError(
          `toVirtualClass: "${name}" is not in the allowed list`
        );
      }

      const NativeSuperClass = getPrototypeOf(NativeClass);
      if (NativeSuperClass && !virtualCache.get(NativeSuperClass)) {
        createVirtualClassProxy(NativeSuperClass);
      }

      const descriptor = getTrap(name) || {};
      const allowLiveOwnProperty = allowLiveOwnPropertysConfig.includes(name);

      if (allowLiveOwnProperty) {
        descriptor[initializedCallback] = setLiveVirtuaObject;
      }

      const VirtualSuperClass = virtualCache.get(NativeSuperClass);
      const VirtualClass = createVirtualClass(
        NativeClass,
        {
          [initializedCallback]: descriptor[initializedCallback],
          [connectedCallback]: descriptor[connectedCallback],
          [disconnectedCallback]: descriptor[disconnectedCallback],
          [attributeChangedCallback]: descriptor[attributeChangedCallback],
          [observedAttributes]: descriptor[observedAttributes]
        },
        VirtualSuperClass
      );

      importPropertys(
        VirtualClass,
        importPropertysTarget || NativeClass,
        NativeClass
      );

      virtualCache.set(NativeClass, VirtualClass);

      return VirtualClass;
    }

    return function toVirtualClass() {
      return createVirtualClassProxy(...arguments);
    };
  }

  toVirtualClass.cacheResult = true;

  /**
   * 真实 BOM 环境方法安全代理。例如
   * 1. elem.addEventListener(type, callback) 中的 addEventListener
   * 2. elem.appendChild(elem) 中的 appendChild
   * 3. elem.innerHTML 中的 getter 与 setter
   * @param {function} $method 目标函数
   * @return {function} 代理函数
   */
  function toVirtualFunction({
    callAndWrapError,
    evaluate,
    langUtils: { defineProperties },
    toNativeAny,
    toVirtualAny,
    virtualCache
  }) {
    const createVirtualFunctionProxy = evaluate(
      (
        callAndWrapError,
        $callback,
        defineProperties,
        toNativeAny,
        toVirtualAny
      ) => {
        // eslint-disable-next-line consistent-return
        function virtualFunctionProxy(...params) {
          return callAndWrapError(() => {
            const context = this;
            const $context = toNativeAny(context);
            const $params = params.map(param => toNativeAny(param));
            const $result = Reflect.apply($callback, $context, $params);
            return toVirtualAny($result);
          });
        }

        defineProperties(virtualFunctionProxy, {
          name: {
            value: $callback.name,
            configurable: true
          }
        });

        return virtualFunctionProxy;
      }
    );

    return function toVirtualFunction($callback) {
      if (virtualCache.has($callback)) {
        return virtualCache.get($callback);
      }

      const proxy = createVirtualFunctionProxy(
        callAndWrapError,
        $callback,
        defineProperties,
        toNativeAny,
        toVirtualAny
      );

      virtualCache.set($callback, proxy);
      return proxy;
    };
  }

  toVirtualFunction.cacheResult = true;

  function contains(documentView, node) {
    if (documentView.contains(node)) {
      return true;
    }

    if (documentView.ownerDocument.contains(node)) {
      return false;
    }

    // 目标元素可能在深层的 shadow dom 中
    let current = node;
    do {
      current = current.getRootNode().host;
      if (current === documentView.host) {
        return true;
      }
    } while (current);

    return false;
  }

  /**
   * 将真实 BOM 环境中的对象转换为虚拟环境中的代理对象
   * @param   {object}    $nativeObject 目标对象
   * @return  {object}   虚拟代理对象
   */
  function toVirtualObject(
    {
      bindObject,
      browserUtils: { queueMicrotask },
      currentNativeObject,
      documentView: $documentView,
      global,
      langUtils: { construct, toString },
      parent: $parent,
      SandboxSecurityError,
      toVirtualClass,
      virtualCache
    },
    $nativeObject
  ) {
    if (virtualCache.has($nativeObject)) {
      return virtualCache.get($nativeObject);
    }

    if ($nativeObject instanceof global.Object) {
      return $nativeObject;
    }

    if ($nativeObject === $parent) {
      return global;
    }

    if ($nativeObject === $documentView) {
      return global.document;
    }

    const constructor = $nativeObject.constructor;
    const VirtualClass = constructor && toVirtualClass(constructor);

    // 产生拒绝访问的错误原因：
    // 1. 试图让沙箱访问未经允许（注册）的对象
    // 2. 内部未知漏洞暴露了全局对象
    // 3. 试图让沙箱可越界访问父节点
    if (
      !VirtualClass ||
      ($nativeObject instanceof $parent.Node &&
        $nativeObject.isConnected &&
        !contains($documentView, $nativeObject))
    ) {
      queueMicrotask(() => {
        $parent.console.error(
          '[DEBUG] SandboxSecurityError:',
          'toVirtualObject(',
          $nativeObject,
          ')'
        );
      });

      throw new SandboxSecurityError(`Forbidden: ${toString($nativeObject)}`);
    }

    currentNativeObject.set($nativeObject);
    const virtualObject = construct(VirtualClass, []);
    currentNativeObject.set(null);
    bindObject(virtualObject, $nativeObject);

    return virtualObject;
  }

  /**
   * 包装函数的错误对象
   * @param   {function}   target  目标
   */
  function wrapError({
    evaluate,
    global,
    langUtils: { apply, isObject },
    toVirtualAny
  }) {
    const createWrapErrorProxy = evaluate(
      (target, apply, isObject, global, toVirtualAny) => {
        // eslint-disable-next-line consistent-return
        return function() {
          try {
            return apply(target, this, arguments);
          } catch (error) {
            if (isObject(error) && error instanceof global.Object) {
              throw error;
            }
            throw toVirtualAny(error);
          }
        };
      }
    );

    return function wrapError(target) {
      return createWrapErrorProxy(target, apply, isObject, global, toVirtualAny);
    };
  }

  wrapError.cacheResult = true;

  /**
   * CSP 规则验证器
   */
  function cspValidation({
    parent: $parent,
    createCSPValidation,
    csp,
    SandboxSecurityError
  }) {
    const cspv = createCSPValidation(csp);
    return function cspValidation(name, value, messageType) {
      const { valid, message } = cspv.validity(name, value);

      if (!valid) {
        if (messageType === 'warn') {
          $parent.console.error(new SandboxSecurityError(message));
        } else if (messageType === 'error') {
          throw new SandboxSecurityError(message);
        }
      }

      return valid;
    };
  }

  cspValidation.cacheResult = true;

  /**
   * cssStylesheet 过滤器
   */
  function cssStyleSheetFilter(
    { cssStyleSheetFilter, documentView, parent, symbols: { elementDefined } },
    cssStyleSheet
  ) {
    const cssRuleList = cssStyleSheet.cssRules;
    let count = cssRuleList.length - 1;

    while (count >= 0) {
      const rule = cssRuleList[count];
      switch (true) {
        case rule instanceof parent.CSSImportRule ||
          rule instanceof parent.CSSMediaRule:
          cssStyleSheet.deleteRule(count);
          break;

        case rule instanceof parent.CSSSupportsRule:
          cssStyleSheetFilter(rule);
          break;

        case rule instanceof parent.CSSStyleRule:
          if (
            rule.selectorText.includes(':host') &&
            documentView.contains(cssStyleSheet.ownerNode)
          ) {
            const selectorFilter = rule.selectorText
              .split(',')
              .filter(s => !s.includes(':host'))
              .join(',');
            if (selectorFilter.length !== 0) {
              const cssText = rule.cssText.replace(/[^{]*/, selectorFilter);
              cssStyleSheet.insertRule(cssText, count + 1);
            }
            cssStyleSheet.deleteRule(count);
          } else if (rule.selectorText.includes(':defined')) {
            const cssText = rule.cssText.replace(
              ':defined',
              `[${elementDefined}]`.replace('.', '\\.') // .需要被转义， 否则规则会解析失败
            );
            cssStyleSheet.insertRule(cssText, count);
          }
          break;
      }
      count--;
    }
  }

  function currentNativeObject() {
    let currentNativeObject = null;
    return {
      get() {
        return currentNativeObject;
      },
      set(value) {
        currentNativeObject = value;
      }
    };
  }

  currentNativeObject.cacheResult = true;

  function currentScript() {
    let currentScript = null;
    return {
      get() {
        return currentScript;
      },
      set(value) {
        currentScript = value;
      }
    };
  }

  currentScript.cacheResult = true;

  function events({ browserUtils: { Events } }) {
    return new Events();
  }

  events.cacheResult = true;

  /**
   * 安全错误类
   */
  function SandboxSecurityError({ evaluate }) {
    const create = () =>
      class WebSandboxSecurityError extends TypeError {
        constructor() {
          super(...arguments);
          this.name = 'WebSandboxSecurityError';
        }
      };
    return evaluate(create)();
  }

  SandboxSecurityError.cacheResult = true;

  /**
   * DOM 消毒器
   */
  function sanitizer({
    createSanitizer,
    isJavaScriptType,
    parent,
    symbols: { scriptType }
  }) {
    const ALLOW_PARENT_CUSTOM_ELEMENTS = ['web-sandbox', 'web-widget'];
    return createSanitizer({
      // ...[
      //   'allowElements',
      //   'blockElements',
      //   'dropElements',
      //   'allowAttributes',
      //   'dropAttributes'
      // ].reduce((accumulator, name) => {
      //   accumulator[name] = permissionsConfig[name];
      //   return accumulator;
      // }, {}),
      uponSanitizeElement(element, data) {
        if (!element.tagName) {
          return;
        }
        if (data.tagName === 'script' && isJavaScriptType(element.type)) {
          // 将可执行的脚本转换为安全的沙箱脚本
          element.setAttribute('type', scriptType);
        } else if (
          parent.customElements.get(data.tagName) ||
          (element.getAttribute('is') &&
            parent.customElements.get(element.getAttribute('is')))
        ) {
          if (!ALLOW_PARENT_CUSTOM_ELEMENTS.includes(data.tagName)) {
            element.parentNode.removeChild();
          }
        }
      }
    });
  }

  sanitizer.cacheResult = true;

  function symbols$1({ windowView }) {
    const prefix = `${windowView.localName}.`;
    // 沙箱内部私有方法的符号
    return {
      // 沙箱内元素的内部属性前缀
      prefix,
      // 沙箱内安全的脚本类型
      scriptType: `${prefix}script`,
      // 沙箱内禁用元素的特殊标记
      disabled: `${prefix}disabled`,
      // 沙箱内已经被定义的自定义元素特殊标记
      elementDefined: `${prefix}defined`,
      // Class 实例化时调用
      initializedCallback: Symbol('initializedCallback'),
      // 元素连接到文档 DOM 时被调用
      connectedCallback: Symbol('connectedCallback'),
      // 元素与文档DOM断开连接时被调用
      disconnectedCallback: Symbol('disconnectedCallback'),
      // 元素的一个属性被增加、移除或更改时被调用
      attributeChangedCallback: Symbol('attributeChangedCallback'),
      // 元素要观察的属性列表
      observedAttributes: Symbol('observedAttributes'),
      // 静态属性
      statics: Symbol('statics')
    };
  }

  symbols$1.cacheResult = true;

  /**
   * 变更 DOM 的辅助函数
   * @param   {string}    method
   * @param   {function}  nodesToAddCollector
   * @param   {function}  nodesToRemoveCollector
   * @return  {function}
   */
  function toVirtualNodeCreater(
    {
      events,
      langUtils: { from },
      parent,
      toNativeAny,
      toNativeObject,
      toVirtualAny
    },
    method,
    nodesToAddCollector,
    nodesToRemoveCollector
  ) {
    return function virtualNodeCreater() {
      const DOCUMENT_FRAGMENT_NODE = parent.Node.DOCUMENT_FRAGMENT_NODE;

      let data;
      const $target = toNativeObject(this);
      const $params = from(arguments).map(param => toNativeAny(param));
      const isConnected = $target.isConnected;

      if (isConnected) {
        data = {
          newNodes: nodesToAddCollector($params, $target)
            .map($node =>
              $node.nodeType === DOCUMENT_FRAGMENT_NODE
                ? [...$node.childNodes]
                : $node
            )
            .flat(1),
          oldNodes: nodesToRemoveCollector($params, $target)
        };
      }

      const $result = $target[method](...$params);

      if (isConnected) {
        events.dispatch('mutation', data);
      }

      return toVirtualAny($result);
    };
  }

  var bridge = /*#__PURE__*/Object.freeze({
    __proto__: null,
    bindObject: bindObject,
    callAndWrapError: callAndWrapError,
    createVirtualClass: createVirtualClass,
    toLiveVirtuaObject: toLiveVirtuaObject,
    toNativeAny: toNativeAny,
    toNativeFunction: toNativeFunction,
    toNativeObject: toNativeObject,
    toVirtualAny: toVirtualAny,
    toVirtualClass: toVirtualClass,
    toVirtualFunction: toVirtualFunction,
    toVirtualObject: toVirtualObject,
    wrapError: wrapError,
    cspValidation: cspValidation,
    cssStyleSheetFilter: cssStyleSheetFilter,
    currentNativeObject: currentNativeObject,
    currentScript: currentScript,
    events: events,
    SandboxSecurityError: SandboxSecurityError,
    sanitizer: sanitizer,
    symbols: symbols$1,
    toVirtualNodeCreater: toVirtualNodeCreater
  });

  /* global window, fetch,  URL, setTimeout, EventTarget, CustomEvent */
  let promise;

  const queueMicrotask =
    typeof window.queueMicrotask === 'function'
      ? window.queueMicrotask
      : // eslint-disable-next-line no-return-assign
        callback =>
          (promise || (promise = Promise.resolve())).then(callback).catch(error =>
            setTimeout(() => {
              throw error;
            }, 0)
          );

  class Events {
    constructor() {
      this.eventTarget = new EventTarget();
    }

    add(type, callback) {
      this.eventTarget.addEventListener(type, ({ detail }) => callback(detail));
    }

    dispatch(type, detail) {
      this.eventTarget.dispatchEvent(
        new CustomEvent(type, {
          detail
        })
      );
    }
  }

  function scriptSourceLoader(url, options = {}) {
    return fetch(url, {
      credentials: 'same-origin',
      ...options
    }).then(res => {
      if (!res.ok) {
        throw Error([res.status, res.statusText, url].join(', '));
      }
      const jsContentTypeRegEx = /^(text|application)\/(x-)?javascript(;|$)/;
      const sourceURLRegEx = /(\/\/# sourceURL=)((https?:\/\/)?([\w-])+\.{1}([a-zA-Z]{2,63})([/\w-]*)*\/?\??([^#\n\r]*)?)/;
      const contentType = res.headers.get('content-type');

      if (!contentType || !jsContentTypeRegEx.test(contentType)) {
        throw Error(contentType);
      }

      return res.text().then(source => {
        if (!sourceURLRegEx.test(source)) {
          source += `\n//# sourceURL=${url}`;
        } else {
          // 将相对路径的 sourceURL 转化为绝对路径
          source = source.replace(
            sourceURLRegEx,
            (match, left, sourceURL) => `${left}${URL(sourceURL, url).href}`
          );
        }
        return source;
      });
    });
  }

  var browser = /*#__PURE__*/Object.freeze({
    __proto__: null,
    queueMicrotask: queueMicrotask,
    Events: Events,
    scriptSourceLoader: scriptSourceLoader
  });

  let lazyInterfaces;
  const cache = new WeakMap();
  function createGetter(name) {
    function get() {
      try {
        const {
          isFunction,
          isObject,
          parent,
          toVirtualAny,
          toVirtualClass
        } = cache.get(this);
        let value;
        const target = parent[name];

        if (isFunction(target)) {
          value = toVirtualClass(target);
        } else if (isObject(target)) {
          value = toVirtualAny(target);
        }

        Reflect.defineProperty(this, name, {
          value,
          writable: true,
          enumerable: false,
          configurable: true
        });
        return value;
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
        return null;
      }
    }

    // 避免虚拟环境通过 Reflect.getOwnPropertyDescriptor(window, name).get 获取到主文档函数的原型对象
    Reflect.setPrototypeOf(get, null);
    return get;
  }

  function installBOMInterfaces({
    global,
    langUtils: {
      defineProperties,
      defineProperty,
      getOwnPropertyNames,
      hasOwnProperty,
      isFunction,
      isObject
    },
    parent,
    toVirtualAny,
    toVirtualClass
  }) {
    // 使用懒加载优化初始化的性能
    if (!lazyInterfaces) {
      const allowInterfaces = permissions.allowInterfaces;
      const values =
        allowInterfaces === '*'
          ? getOwnPropertyNames(parent)
          : getOwnPropertyNames(allowInterfaces);

      lazyInterfaces = values
        // eslint-disable-next-line no-restricted-globals
        .filter(name => !hasOwnProperty(global, name))
        .reduce((accumulator, name) => {
          accumulator[name] = {
            enumerable: false,
            configurable: true,
            get: createGetter(name),
            set(value) {
              defineProperty(global, name, {
                value,
                writable: true,
                enumerable: false,
                configurable: true
              });
            }
          };
          return accumulator;
        }, {});
    }

    cache.set(global, {
      isFunction,
      isObject,
      parent,
      toVirtualAny,
      toVirtualClass
    });
    defineProperties(global, lazyInterfaces);
  }

  function installContainLayout({
    parent: $parent,
    symbols: { prefix },
    windowView: $windowView
  }) {
    // 声明独立的渲染部分，防止沙箱内的元素在视觉层面逃逸。例如设置 position: fixed
    const id = `${prefix}style`;
    if (!$parent.document.getElementById(id)) {
      const style = $parent.document.createElement('style');
      const containLayout =
        'contain' in $windowView.style
          ? 'contain: layout'
          : 'transform: scale(1)';
      style.textContent = `${$windowView.localName} { ${containLayout}; overflow: hidden; }`;
      style.id = id;
      $parent.document.head.appendChild(style);
    }
  }

  function installHooks({
    cspValidation,
    events,
    global,
    symbols,
    toVirtualObject,
    parent: $parent,
    langUtils: { isString }
  }) {
    $parent.addEventListener('hashchange', $event => {
      const event = toVirtualObject(
        new $event.constructor($event.type, {
          newUrl: $event.newURL,
          oldURL: $event.oldURL
        })
      );
      global.dispatchEvent(event);
    });

    // $parent.addEventListener('popstate', $event => {
    //   const event = toVirtualObject(
    //     new $event.constructor($event.type, {
    //       state: $event.state
    //     })
    //   );
    //   global.dispatchEvent(event);
    // });

    function clickEventHook($event) {
      if (!cspValidation('navigate-to', $event.target.href, 'warn')) {
        $event.preventDefault();
      }
    }

    function submitEventHook($event) {
      let url = $event.target.action;
      const { submitter } = $event;

      if (submitter) {
        // submitter.formAction 有默认值，所以必须使用 getAttribute 检测是否有真正的值
        const hasFormAction = submitter.getAttribute('formaction');
        if (hasFormAction) {
          url = submitter.formAction;
        }
      }

      // TODO 确认 form-action 与 navigate-to 先后顺序
      if (
        !cspValidation('form-action', url, 'warn') ||
        !cspValidation('navigate-to', url, 'warn')
      ) {
        $event.preventDefault();
      }
    }

    // 连接文档
    function connectedHook($node) {
      if (isString($node)) {
        // document.body.append('text') 的情况
        return;
      }
      const node = toVirtualObject($node);
      const localName = $node.localName;
      const describe = global.customElements.get(
        (node.nodeType === 1 && node.getAttribute('is')) || node.localName
      );

      if (node[symbols.connectedCallback]) {
        // 连接文档（仅内部使用）
        node[symbols.connectedCallback]();
      } else if (describe && !(node instanceof describe)) {
        // 未 upgrade 的自定义元素
        global.customElements.upgrade(node);
      } else if (describe && node.connectedCallback) {
        // 已经 upgrade 的自定义元素
        node.connectedCallback();
      }

      if (localName === 'a') {
        $node.addEventListener('click', clickEventHook, true);
      } else if (localName === 'form') {
        $node.addEventListener('submit', submitEventHook, true);
      }

      $node.childNodes.forEach(connectedHook);
    }

    // 从文档中断开
    function disconnectedHook($node) {
      const node = toVirtualObject($node);
      const localName = $node.localName;

      if (node[symbols.disconnectedCallback]) {
        // 从文档中断开（仅内部使用）
        node[symbols.disconnectedCallback]();
      } else if (global.customElements.get(node.localName)) {
        if (node.disconnectedCallback) {
          // 从文档中断开
          node.disconnectedCallback();
        }
      }

      if (localName === 'a') {
        $node.removeEventListener('click', clickEventHook);
      } else if (localName === 'form') {
        $node.removeEventListener('submit', submitEventHook);
      }

      $node.childNodes.forEach(disconnectedHook);
    }

    events.add('mutation', ({ newNodes, oldNodes }) => {
      try {
        oldNodes.forEach(disconnectedHook);
        newNodes.forEach(connectedHook);
      } catch (error) {
        /* TODO innerHTML 支持 SVG 元素创建，但是这些元素在沙箱中尚未实现使用接口访问 */
        $parent.console.error(error);
      }
    });

    const $document = $parent.document;
    const $URL = $parent.URL;
    const createAbsoluteUrl = value => new $URL(value, $document.baseURI);
    const click = global.HTMLAnchorElement.prototype.click;
    const submit = global.HTMLFormElement.prototype.submit;
    const open = global.XMLHttpRequest.prototype.open;
    const fetch = global.fetch;

    /* TODO 安全问题：主文档的 function 对象泄漏到了沙箱 */
    global.HTMLAnchorElement.prototype.click = function() {
      cspValidation('navigate-to', this.href, 'error');
      return click.apply(this, arguments);
    };

    global.HTMLFormElement.prototype.submit = function() {
      cspValidation('navigate-to', this.action, 'error');
      cspValidation('form-action', this.action, 'error');
      return submit.apply(this, arguments);
    };

    global.XMLHttpRequest.prototype.open = function() {
      const input = arguments[1];
      const url = createAbsoluteUrl(isString(input) ? input : input.url);
      cspValidation('connect-src', url.href, 'error');
      return open.apply(this, arguments);
    };

    global.fetch = function() {
      const input = arguments[0];
      const url = createAbsoluteUrl(isString(input) ? input : input.url);
      cspValidation('connect-src', url.href, 'error');
      return fetch.apply(this, arguments);
    };
  }

  function installDefaultNodes({
    documentView: $documentView,
    parent: $parent,
    title
  }) {
    const $document = $parent.document;
    const $html = $document.createElement('html');
    const $head = $document.createElement('head');
    const $title = $document.createElement('title');
    const $body = $document.createElement('body');

    $title.textContent = title;
    $head.appendChild($title);

    // // fix: Safari 14.0 (15610.1.28.1.9, 15610): body.style.height = 100vh
    // const $style = $document.createElement('style');
    // $style.textContent = `body { height: min-content }`;
    // $head.appendChild($style);

    $html.appendChild($head);
    $html.appendChild($body);

    $documentView.appendChild($html);
  }

  function installEsTraps({
    virtualCache,
    createVirtualClass,
    currentNativeObject,
    parent: $parent,
    symbols: { initializedCallback },
    toLiveVirtuaObject,
    langUtils: { inherits },
    evaluate
  }) {
    return evaluate(
      (
        virtualCache,
        createVirtualClass,
        currentNativeObject,
        $parent,
        initializedCallback,
        toLiveVirtuaObject,
        inherits
      ) => {
        return [
          'Array',
          'Error',
          'EvalError',
          'Object',
          'Promise',
          'RangeError',
          'ReferenceError',
          'SyntaxError',
          'TypeError',
          'URIError'
        ].map(name => {
          const $Class = $parent[name];
          const Class = createVirtualClass($Class, {
            [initializedCallback]() {
              return inherits(
                this,
                toLiveVirtuaObject(currentNativeObject.get())
              );
            }
          });
          virtualCache.set($Class, Class);
          return Class;
        });
      }
    )(
      virtualCache,
      createVirtualClass,
      currentNativeObject,
      $parent,
      initializedCallback,
      toLiveVirtuaObject,
      inherits
    );
  }

  function installView({
    bindObject,
    currentNativeObject,
    documentView,
    langUtils: { construct, setPrototypeOf, create },
    parent: $parent,
    toVirtualClass,
    windowView,
    global
  }) {
    const Window = toVirtualClass($parent.Window, windowView.constructor);
    const Document = toVirtualClass($parent.Document, documentView.constructor);
    const HTMLDocument = toVirtualClass($parent.HTMLDocument);

    const [window, document] = [
      [windowView, Window, global],
      [documentView, HTMLDocument]
    ].map(([view, VirtualClass, virtualObject]) => {
      currentNativeObject.set(view);
      virtualObject = virtualObject || construct(VirtualClass, []);
      currentNativeObject.set(null);
      bindObject(virtualObject, view);
      return virtualObject;
    });

    setPrototypeOf(global, create(Window.prototype));

    return {
      Window,
      Document,
      window,
      document
    };
  }

  function WindowProperties({
    animationFrameList,
    cspValidation,
    debug,
    documentView,
    global,
    id,
    intervalList,
    langUtils: { defineProperties, entries, has, setPrototypeOf },
    parent: $parent,
    SandboxSecurityError,
    timeoutList,
    toNativeObject,
    toNativeFunction,
    toVirtualFunction,
    toVirtualObject
  }) {
    let location;
    const document = toVirtualObject(documentView);
    const $document = $parent.document;
    const $location = $parent.location;
    const $URL = $parent.URL;

    const createAbsoluteUrl = value => new $URL(value, $document.baseURI);

    const changeLocation = (name, value) => {
      const internalBlacklist = [
        // eslint-disable-next-line no-script-url
        'javascript:',
        'blob:',
        'data:',
        'filesystem:'
      ];
      const isPart = !['href', 'assign', 'replace'].includes(name);
      const $url = new $URL($document.baseURI);

      if (isPart) {
        if (has($url, name)) {
          $url[name] = value;
        }
      } else {
        $url.href = createAbsoluteUrl(value).href;
      }

      if (internalBlacklist.includes($url.protocol)) {
        throw new SandboxSecurityError(`Forbidden: "${$url.protocol}"`);
      }

      // TODO 逻辑迁移到 installHooks 中
      cspValidation('navigate-to', $url.href, 'error');

      if (name === 'reload') {
        $location[name](value);
      } else if (['assign', 'replace'].includes(name)) {
        $location[name]($url.href);
      } else {
        $location.href = $url.href;
      }
    };

    return {
      // TODO 使用自动生成
      console: entries($parent.console).reduce((accumulator, [key, value]) => {
        if (debug) {
          accumulator[key] = value;
          setPrototypeOf(value, null);
        } else {
          accumulator[key] = toVirtualFunction(value);
        }
        return accumulator;
      }, {}),

      get customElements() {
        return toVirtualObject($parent.customElements);
      },

      get localStorage() {
        return toVirtualObject($parent.localStorage);
      },

      name: id,

      get navigator() {
        return toVirtualObject($parent.navigator);
      },

      get self() {
        return global;
      },

      get window() {
        return global;
      },

      get document() {
        return document;
      },

      get location() {
        if (location) {
          return location;
        }

        location = defineProperties(toVirtualObject($location), {
          ...[
            'hash',
            'host',
            'hostname',
            'href',
            'origin',
            'password',
            'pathname',
            'port',
            'protocol',
            'search',
            'username'
          ].reduce((accumulator, name) => {
            accumulator[name] = {
              enumerable: true,
              get() {
                return $location[name];
              },
              set(value) {
                changeLocation(name, value);
              }
            };

            return accumulator;
          }, {}),

          ...['assign', 'reload', 'replace'].reduce((accumulator, name) => {
            accumulator[name] = {
              enumerable: true,
              value(value) {
                changeLocation(name, value);
              }
            };
            return accumulator;
          }, {}),

          ...{
            toString: {
              enumerable: true,
              value() {
                return this.href;
              }
            }
          }
        });

        return location;
      },

      set location(value) {
        this.location.href = value;
      },

      close() {
        if (!global.closed) {
          const {
            dispatchEvent,
            clearTimeout,
            clearInterval,
            cancelAnimationFrame,
            document,
            Event
          } = global;

          dispatchEvent(new Event('beforeunload'));
          dispatchEvent(new Event('pagehide'));
          dispatchEvent(new Event('unload'));

          timeoutList.forEach(id => clearTimeout(id));
          intervalList.forEach(id => clearInterval(id));
          animationFrameList.forEach(id => cancelAnimationFrame(id));

          document.removeChild(document.documentElement);
          global.closed = true;
        }
      },

      getComputedStyle(element, pseudoElt) {
        const $element = toNativeObject(element);
        const $style = $parent.getComputedStyle($element, pseudoElt);
        return toVirtualObject($style);
      },

      requestAnimationFrame(callback, ...args) {
        return animationFrameList.push(
          $parent.requestAnimationFrame(toNativeFunction(callback), ...args)
        );
      },

      cancelAnimationFrame(id) {
        const index = animationFrameList.indexOf(id);
        if (index !== -1) {
          animationFrameList.splice(index, 1);
          $parent.cancelAnimationFrame(id);
        }
      }
    };
  }

  function WindowOrWorkerGlobalScope({
    intervalList,
    langUtils: { isString },
    parent: $parent,
    SandboxSecurityError,
    timeoutList,
    toNativeFunction
  }) {
    return {
      setTimeout(callback, ...args) {
        if (isString(callback)) {
          throw new SandboxSecurityError(
            `The first parameter must be a function`
          );
        }
        return timeoutList.push(
          $parent.setTimeout(toNativeFunction(callback), ...args)
        );
      },

      clearTimeout(id) {
        const index = timeoutList.indexOf(id);
        if (index !== -1) {
          timeoutList.splice(index, 1);
          $parent.clearTimeout(id);
        }
      },

      setInterval(callback, ...args) {
        if (isString(callback)) {
          throw new SandboxSecurityError(
            `The first parameter must be a function`
          );
        }
        return intervalList.push(
          $parent.setInterval(toNativeFunction(callback), ...args)
        );
      },

      clearInterval(id) {
        const index = intervalList.indexOf(id);
        if (index !== -1) {
          intervalList.splice(index, 1);
          $parent.clearInterval(id);
        }
      }
    };
  }

  var mixins = /*#__PURE__*/Object.freeze({
    __proto__: null,
    WindowProperties: WindowProperties,
    WindowOrWorkerGlobalScope: WindowOrWorkerGlobalScope
  });

  function installWindowProperties({
    evaluate,
    global,
    injector,
    langUtils: { defineProperty, getOwnPropertyDescriptor, keys, mixin, ownKeys },
    wrapError
  }) {
    keys(mixins).forEach(name => {
      const fn = evaluate(mixins[name]);
      const properties = injector.resolve(fn)();

      ownKeys(properties).forEach(key => {
        const des = getOwnPropertyDescriptor(properties, key);
        keys(des).forEach(k => {
          const rawFn = des[k];
          if (typeof rawFn === 'function') {
            des[k] = wrapError(rawFn);
          }
        });
        defineProperty(properties, key, des);
      });

      mixin(global, properties);
    });
  }

  var initializers = /*#__PURE__*/Object.freeze({
    __proto__: null,
    installBOMInterfaces: installBOMInterfaces,
    installContainLayout: installContainLayout,
    installHooks: installHooks,
    installDefaultNodes: installDefaultNodes,
    installEsTraps: installEsTraps,
    installView: installView,
    installWindowProperties: installWindowProperties
  });

  const extract = (object, keys) =>
    keys.reduce((accumulator, name) => {
      accumulator[name] = object[name];
      return accumulator;
    }, {});

  var lang = {
    ...extract(Object, [
      'assign',
      'create',
      'defineProperties',
      'defineProperty',
      'entries',
      'freeze',
      'fromEntries',
      'getOwnPropertyDescriptor',
      'getOwnPropertyDescriptors',
      'getOwnPropertyNames',
      'getOwnPropertySymbols',
      'getPrototypeOf',
      'is',
      'isExtensible',
      'isFrozen',
      'isSealed',
      'keys',
      'preventExtensions',
      'seal',
      'setPrototypeOf',
      'values'
    ]),

    ...extract(Reflect, [
      'apply',
      'construct',
      // 'defineProperty',
      'deleteProperty',
      'get',
      // 'getOwnPropertyDescriptor',
      // 'getPrototypeOf',
      'has',
      // 'isExtensible',
      'ownKeys',
      // 'preventExtensions',
      'set'
      // 'setPrototypeOf'
    ]),

    from: Array.from,

    isArray(arg) {
      return Array.isArray(arg);
    },

    isBoolean(arg) {
      return typeof arg === 'boolean';
    },

    isNull(arg) {
      return arg === null;
    },

    // isNullOrUndefined(arg) {
    //   return arg == null;
    // },

    isNumber(arg) {
      return typeof arg === 'number';
    },

    isString(arg) {
      return typeof arg === 'string';
    },

    // isSymbol(arg) {
    //   return typeof arg === 'symbol';
    // },

    // isUndefined(arg) {
    //   // eslint-disable-next-line no-void
    //   return arg === void 0;
    // },

    // isRegExp(re) {
    //   return objectToString(re) === '[object RegExp]';
    // },

    // @return object and array
    isObject(arg) {
      return typeof arg === 'object' && arg !== null;
    },

    // isDate(d) {
    //   return objectToString(d) === '[object Date]';
    // },

    // isError(e) {
    //   return objectToString(e) === '[object Error]' || e instanceof Error;
    // },

    isFunction(arg) {
      return typeof arg === 'function';
    },

    // isPrimitive(arg) {
    //   return (
    //     arg === null ||
    //     typeof arg === 'boolean' ||
    //     typeof arg === 'number' ||
    //     typeof arg === 'string' ||
    //     typeof arg === 'symbol' || // ES6 symbol
    //     typeof arg === 'undefined'
    //   );
    // },

    hasOwnProperty(object, key) {
      return Object.prototype.hasOwnProperty.call(object, key);
    },

    toString(object) {
      return Object.prototype.toString.call(object);
    },

    inherits(target, source) {
      const {
        has,
        get,
        ownKeys,
        set,
        deleteProperty,
        getOwnPropertyDescriptor
      } = Reflect;
      return new Proxy(target, {
        get(target, property, receiver) {
          const params = has(target, property)
            ? [target, property, receiver]
            : [source, property];
          return get(...params);
        },

        has(target, property) {
          return has(target, property) || has(source, property);
        },

        ownKeys(target) {
          return new Set(...ownKeys(target), ...ownKeys(source));
        },

        set(target, property, value, receiver) {
          const params = has(target, property)
            ? [target, property, value, receiver]
            : [source, property, value];
          return set(...params);
        },

        deleteProperty(target, property) {
          return deleteProperty(
            has(target, property) ? target : source,
            property
          );
        },

        getOwnPropertyDescriptor(target, property) {
          return getOwnPropertyDescriptor(
            has(target, property) ? target : source,
            property
          );
        }
      });
    },

    mixin(target, source) {
      const { defineProperty, getOwnPropertyDescriptor, ownKeys } = Reflect;
      ownKeys(source).forEach(name => {
        const descriptor = getOwnPropertyDescriptor(source, name);
        defineProperty(target, name, descriptor);
      });
    }
  };

  /* global URL, document */

  const toPathList = path => path.replace(/^\/|\/$/g, '').split('/');

  // https://www.w3.org/TR/CSP2/#match-source-expression
  function matchSource(source, input, location = document.location) {
    source = source.toLowerCase();
    input = input.toLowerCase();

    // 1. Let url be the result of processing the URL through the URL parser.
    const url = new URL(input);
    const schemeSource = /^[a-z][a-z0-9+.-]*:$/i;
    // eslint-disable-next-line no-useless-escape
    const hostSource = /^(?:(?<scheme>[a-z][a-z0-9+.-]*):\/\/)?(?<host>\[[0-9A-F:.]{2,}\]|(?:[^'\/?#:]|%[0-9A-F]{2})+)(?::(?<port>[^\/?]*))?(?<path>[^?#]*)?$/i;

    // 2. If the source expression a consists of a single U+002A ASTERISK character (*), and url’s scheme is not one of blob, data, filesystem, then return does match.
    if (source === '*') {
      return !['blob:', 'data:', 'filesystem:'].includes(url.protocol);
    }

    // 3. If the source expression matches the grammar for scheme-source:
    if (source.match(schemeSource)) {
      // 1. If url’s scheme is an ASCII case-insensitive match for the source expression’s scheme-part, return does match.
      // 2. Otherwise, return does not match.
      return url.protocol === source;
    }

    // 4. If the source expression matches the grammar for host-source:
    if (source.match(hostSource)) {
      const { scheme, host, port, path } = source.match(hostSource).groups;

      // 1. If url’s host is null, return does not match.
      if (!url.hostname) {
        return false;
      }

      // 2. Let url-scheme, url-host, and url-port be the scheme, host, and port of url’s origin, respectively.
      // Note: If url doesn’t specify a port, then its origin’s port will be the default port for url’s scheme.
      const urlScheme = url.protocol.replace(':', '');
      const urlHost = url.hostname;
      const urlPort = url.port;
      const urlPath = url.pathname;

      // 3. Let url-path-list be the path of url.
      const urlPathList = toPathList(urlPath);

      // 4. If the source expression has a scheme-part that is not a case insensitive match for url-scheme, then return does not match.
      if (scheme) {
        if (urlScheme !== scheme) {
          return false;
        }
      }

      // 5. If the source expression does not have a scheme, return does not match if any of the following are true:
      //    1. the scheme of the protected resource’s URL is a case insensitive match for HTTP, and url-scheme is not a case insensitive match for either HTTP or HTTPS
      //    2. the scheme of the protected resource’s URL is not a case insensitive match for HTTP, and url-scheme is not a case insensitive match for the scheme of the protected resource’s URL.
      if (!scheme) {
        const protectedResourceScheme = location.protocol.replace(':', '');
        if (
          (protectedResourceScheme === 'http' &&
            urlScheme !== 'http' &&
            urlScheme !== 'https') ||
          (protectedResourceScheme !== 'http' &&
            urlScheme !== protectedResourceScheme)
        ) {
          return false;
        }
      }

      // 6. If the first character of the source expression’s host-part is an U+002A ASTERISK character (*) and the remaining characters, including the leading U+002E FULL STOP character (.), are not a case insensitive match for the rightmost characters of url-host, then return does not match.
      if (host.startsWith('*')) {
        if (!urlHost.endsWith(host.slice(1))) {
          return false;
        }
      }

      // 7. If the first character of the source expression’s host-part is not an U+002A ASTERISK character (*) and url-host is not a case insensitive match for the source expression’s host-part, then return does not match.
      else if (urlHost !== host) {
        return false;
      }

      // 8. If the source expression’s host-part matches the IPv4address production from [RFC3986], and is not 127.0.0.1, or is an IPv6 address, return does not match.
      // Note: A future version of this specification may allow literal IPv6 and IPv4 addresses, depending on usage and demand. Given the weak security properties of IP addresses in relation to named hosts, however, authors are encouraged to prefer the latter whenever possible.
      const IPv4 = /^[\d.]+$/;
      const IPv6 = /^\[.*\]$/;
      if ((IPv4.test(host) && host !== '127.0.0.1') || IPv6.test(host)) {
        return false;
      }

      // 9. If the source expression does not contain a port-part and url-port is not the default port for url-scheme, then return does not match.
      if (!port) {
        const defaultPort = {
          ftp: 21,
          http: 80,
          https: 443,
          ws: 80,
          wss: 443
        };
        if (!['', defaultPort[urlScheme]].includes(urlPort)) {
          return false;
        }
      }

      // 10. If the source expression does contain a port-part, then return does not match if both of the following are true:
      //    1. port-part does not contain an U+002A ASTERISK character (*)
      //    2. port-part does not represent the same number as url-port
      else if (port !== '*' && urlPort !== port) {
        return false;
      }

      // 11. If the source expression contains a non-empty path-part, and the URL is not the result of a redirect, then:
      if (path) {
        // 1. Let exact-match be true if the final character of path-part is not the U+002F SOLIDUS character (/), and false otherwise.
        const exactMatch = !path.endsWith('/');

        // 2. Let source-expression-path-list be the result of splitting path-part on the U+002F SOLIDUS character (/).
        const sourcePathList = toPathList(path);

        // 3. If source-expression-path-list’s length is greater than url-path-list’s length, return does not match.
        if (sourcePathList.length > urlPathList.length) {
          return false;
        }

        // 4. For each entry in source-expression-path-list:
        //     1. Percent decode entry.
        //     2. Percent decode the first item in url-path-list.
        //     3. If entry is not an ASCII case-insensitive match for the first item in url-path-list, return does not match.
        //     4. Pop the first item in url-path-list off the list.
        for (let sourceEntry of sourcePathList) {
          sourceEntry = decodeURIComponent(sourceEntry);
          const urlEntry = decodeURIComponent(urlPathList[0]);
          if (urlEntry !== sourceEntry) {
            return false;
          }
          urlPathList.shift();
        }

        // 5. If exact-match is true, and url-path-list is not empty, return does not match.
        if (exactMatch && urlPathList.length > 0) {
          return false;
        }
      }

      // 12. Otherwise, return does match.
      return true;
    }

    // 5. If the source expression is a case insensitive match for 'self' (including the quotation marks), then:
    //    1. Return does match if the origin of url matches the origin of protected resource’s URL.
    // Note: This includes IP addresses. That is, a document at https://111.111.111.111/ with a policy of img-src 'self' can load the image https://111.111.111.111/image.png, as the origins match.
    if (source === "'self'") {
      const { protocol, hostname, port } = location;
      return (
        url.protocol === protocol &&
        url.hostname === hostname &&
        url.port === port
      );
    }

    // 6. Otherwise, return does not match.
    return false;

    // 参考资料
    // https://tools.ietf.org/html/rfc3986#section-3
    // https://gist.github.com/curtisz/11139b2cfcaef4a261e0
    // https://github.com/wizard04wsu/URI_Parsing
    // const RFC3986 = /^(?:(?<scheme>[^:\/?#]+):)?(?:\/\/(?<authority>[^\/?#]*))?(?<path>[^?#]*)?(?:\?(?<query>[^#]*))?(?:#(?<fragment>.*))?/;
    // const RFC3986 = /^(?:(?<scheme>[^:\/?#]+):)?(?:\/\/(?<authority>(?:(?<userinfo>[^\/]*)@)?(?<host>\[[0-9A-F:.]{2,}\]|(?:[^\/?#:]|%[0-9A-F]{2})*)(?::(?<port>[^\/?]*))?))?(?<path>[^?#]*)(?:\?(?<query>[^#]*))?(?:#(?<fragment>.*))?$/i;
  }

  /* eslint-disable no-useless-escape */

  const FALLBACKS = [
    // 'child-src',
    'connect-src',
    // 'font-src',
    // 'img-src',
    // 'media-src',
    // 'object-src',
    'script-src',
    'style-src'
  ];

  class CSPValidation {
    constructor(policy) {
      this.policy = {
        ...(typeof policy === 'string' ? parsePolicy(policy) : policy)
      };
    }

    validity(name, value) {
      let valid = true;
      let message = '';
      let sourceList = this.policy[name];

      if (!sourceList && FALLBACKS.includes(name)) {
        name = 'default-src';
        sourceList = this.policy[name] || ['*'];
      }

      if (!sourceList) {
        return {
          valid,
          message
        };
      }

      valid =
        sourceList.length &&
        sourceList.some(source => matchSource(source, value));

      if (!valid) {
        message = `Refused: ${JSON.stringify(
        value
      )}: Because it violates the following Content Security Policy directive: "${name} ${sourceList.join(
        ' '
      )}"`;
      }

      return {
        valid,
        message
      };
    }
  }

  /* eslint-disable no-useless-escape */
  const DATA_ATTR = Object.seal(/^data-[\-\w.\u00B7-\uFFFF]/);
  const ARIA_ATTR = Object.seal(/^aria-[\-\w]+$/);
  const IS_ALLOWED_URI = Object.seal(
    /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i
  );
  const IS_SCRIPT_OR_DATA = Object.seal(/^(?:\w+script|data):/i);
  const ATTR_WHITESPACE = Object.seal(
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u0020\u00A0\u1680\u180E\u2000-\u2029\u205F\u3000]/g
  );

  /* global window */

  const {
    Node,
    NodeFilter,
    Text,
    Comment,
    NamedNodeMap,
    DocumentFragment,
    document: document$1
  } = window;

  const executeHook = Symbol('executeHook');
  const sanitizeElements = Symbol('sanitizeElements');
  const sanitizeAttributes = Symbol('sanitizeAttributes');
  const sanitizeShadowDOM = Symbol('sanitizeShadowDOM');
  const sanitizeString = Symbol('sanitizeString');

  /**
   * We consider the elements and attributes below to be safe. Ideally
   * don't add any new ones but feel free to remove unwanted ones.
   */

  const DROP_ELEMENTS = [
    'base',
    'embed',
    'iframe',
    'meta',
    'noscript',
    'object',
    'param',
    'frame',
    'frameset',
    'noframes'
  ];

  /* Tags to ignore content */
  const FORBID_CONTENTS = [
    'annotation-xml',
    'audio',
    'colgroup',
    'desc',
    'foreignobject',
    'head',
    'iframe',
    'math',
    'mi',
    'mn',
    'mo',
    'ms',
    'mtext',
    'noembed',
    'noframes',
    'noscript',
    'plaintext',
    'script',
    'style',
    'svg',
    'template',
    'thead',
    'title',
    'video',
    'xmp'
  ];

  /* Tags that are safe for data: URIs */
  const DATA_URI_TAGS = ['audio', 'video', 'img', 'source', 'image', 'track'];

  /* Attributes safe for values like "javascript:" */
  const URI_SAFE_ATTRIBUTES = [
    'alt',
    'class',
    'for',
    'id',
    'label',
    'name',
    'pattern',
    'placeholder',
    'summary',
    'title',
    'value',
    'style',
    'xmlns'
  ];

  const formElement = document$1.createElement('form');

  /**
   * forceRemove
   *
   * @param  {Node} node a DOM node
   */
  const forceRemove = node => {
    try {
      node.parentNode.removeChild(node);
    } catch (_) {
      try {
        node.outerHTML = '';
      } catch (_) {
        node.remove();
      }
    }
  };

  /**
   * removeAttribute
   *
   * @param  {String} name an Attribute name
   * @param  {Node} node a DOM node
   */
  const removeAttribute = function(name, node) {
    node.removeAttribute(name);

    // We void attribute values for unremovable "is"" attributes
    if (name === 'is') {
      try {
        node.setAttribute(name, '');
        // eslint-disable-next-line no-empty
      } catch (_) {}
    }
  };

  /**
   * initDocument
   *
   * @param  {String} dirty a string of dirty markup
   * @return {Document} a DOM, filled with the dirty markup
   */
  const initDocument = dirty => {
    /* Create a HTML document */

    const matches = dirty.match(/^[\r\n\t ]+/);
    const leadingWhitespace = matches && matches[0];

    const doc = document$1.implementation.createHTMLDocument('');
    const { body } = doc;
    body.innerHTML = dirty;

    if (dirty && leadingWhitespace) {
      doc.body.insertBefore(
        document$1.createTextNode(leadingWhitespace),
        doc.body.childNodes[0] || null
      );
    }

    return body;
  };

  /**
   * createIterator
   *
   * @param  {Document} root document/fragment to create iterator for
   * @return {Iterator} iterator instance
   */
  const createIterator = root => {
    return (root.ownerDocument || root).createNodeIterator(
      root,
      // eslint-disable-next-line no-bitwise
      NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_COMMENT | NodeFilter.SHOW_TEXT,
      () => {
        return NodeFilter.FILTER_ACCEPT;
      },
      false
    );
  };

  /**
   * isClobbered
   *
   * @param  {Node} elm element to check for clobbering attacks
   * @return {Boolean} true if clobbered, false if safe
   */
  const isClobbered = elm => {
    if (elm instanceof Text || elm instanceof Comment) {
      return false;
    }

    if (
      typeof elm.nodeName !== 'string' ||
      typeof elm.textContent !== 'string' ||
      typeof elm.removeChild !== 'function' ||
      !(elm.attributes instanceof NamedNodeMap) ||
      typeof elm.removeAttribute !== 'function' ||
      typeof elm.setAttribute !== 'function' ||
      typeof elm.namespaceURI !== 'string' ||
      typeof elm.insertBefore !== 'function'
    ) {
      return true;
    }

    return false;
  };

  /**
   * isNode
   *
   * @param  {Node} obj object to check whether it's a DOM node
   * @return {Boolean} true is object is a DOM node
   */
  const isNode = object => {
    return typeof Node === 'object'
      ? object instanceof Node
      : object &&
          typeof object === 'object' &&
          typeof object.nodeType === 'number' &&
          typeof object.nodeName === 'string';
  };

  class Sanitizer {
    constructor(config = {}) {
      this.config = config;
    }

    /**
     * executeHook
     * Execute user configurable hooks
     *
     * @param  {String} entryPoint  Name of the hook's entry point
     * @param  {Node} currentNode node to work on with the hook
     * @param  {Object} data additional hook parameters
     */
    [executeHook](entryPoint, currentNode, data) {
      const hook = this.config[entryPoint];
      if (hook) {
        hook.call(this, currentNode, data, this.config);
      }
    }

    /**
     * sanitizeElements
     *
     * @protect nodeName
     * @protect textContent
     * @protect removeChild
     *
     * @param   {Node} currentNode to check for permission to exist
     * @return  {Boolean} true if node was killed, false if left alive
     */
    [sanitizeElements](currentNode) {
      const { allowElements, dropElements } = this.config;

      /* Execute a hook if present */
      this[executeHook]('beforeSanitizeElements', currentNode, null);

      /* Check if element is clobbered or can clobber */
      if (isClobbered(currentNode)) {
        forceRemove(currentNode);
        return true;
      }

      /* Check if tagname contains Unicode */
      if (currentNode.nodeName.match(/[\u0080-\uFFFF]/)) {
        forceRemove(currentNode);
        return true;
      }

      /* Now let's check the element's type and name */
      const tagName = currentNode.nodeName.toLowerCase();

      /* Execute a hook if present */
      this[executeHook]('uponSanitizeElement', currentNode, {
        tagName,
        allowElements
      });

      /* web-sandbox rules: Default script type */
      if (tagName === 'script' && !currentNode.type) {
        forceRemove(currentNode);
        return true;
      }

      /* Take care of an mXSS pattern using p, br inside svg, math */
      if (
        (tagName === 'svg' || tagName === 'math') &&
        currentNode.querySelectorAll('p, br, form, table, h1, h2, h3, h4, h5, h6')
          .length !== 0
      ) {
        forceRemove(currentNode);
        return true;
      }

      /* Detect mXSS attempts abusing namespace confusion */
      if (
        !isNode(currentNode.firstElementChild) &&
        (!isNode(currentNode.content) ||
          !isNode(currentNode.content.firstElementChild)) &&
        /<[/\w]/g.test(currentNode.innerHTML) &&
        /<[/\w]/g.test(currentNode.textContent)
      ) {
        forceRemove(currentNode);
        return true;
      }

      /* Remove element if anything forbids its presence */
      if (!this.isValidElement(tagName)) {
        /* Keep content except for bad-listed elements */
        const KEEP_CONTENT =
          !DROP_ELEMENTS.includes(tagName) &&
          dropElements &&
          !dropElements.includes(tagName);

        if (KEEP_CONTENT && !FORBID_CONTENTS.includes(tagName)) {
          const parentNode = currentNode.parentNode;
          const childNodes = currentNode.childNodes;
          const childCount = childNodes.length;
          for (let i = childCount - 1; i >= 0; --i) {
            parentNode.insertBefore(
              childNodes[i].cloneNode(true),
              currentNode.nextSibling
            );
          }
        }

        forceRemove(currentNode);
        return true;
      }

      /* Remove in case a noscript/noembed XSS is suspected */
      if (
        (tagName === 'noscript' || tagName === 'noembed') &&
        /<\/no(script|embed)/i.test(currentNode.innerHTML)
      ) {
        forceRemove(currentNode);
        return true;
      }

      /* Execute a hook if present */
      this[executeHook]('afterSanitizeElements', currentNode, null);

      return false;
    }

    /**
     * Public method to check if an attribute value is valid.
     * isValidAttribute
     *
     * @param  {string} tag Tag name of containing element.
     * @param  {string} name Attribute name.
     * @param  {string} value Attribute value.
     * @return {Boolean} Returns true if `value` is valid. Otherwise, returns false.
     */
    isValidAttribute(tag, name, value) {
      const { allowAttributes, dropAttributes } = this.config;

      const lcTag = tag.toLowerCase();
      const lcName = name.toLowerCase();

      /* web-sandbox rules */
      if (
        lcName.indexOf('on') === 0 ||
        (lcTag === 'script' && lcName === 'type' && isJavaScriptType(value))
      ) {
        return false;
      }

      /* Make sure attribute cannot clobber */
      if (
        (lcName === 'id' || lcName === 'name') &&
        (value in document$1 || value in formElement)
      ) {
        return false;
      }

      /* Allow valid data-* attributes: At least one character after "-"
          (https://html.spec.whatwg.org/multipage/dom.html#embedding-custom-non-visible-data-with-the-data-*-attributes)
          XML-compatible (https://html.spec.whatwg.org/multipage/infrastructure.html#xml-compatible and http://www.w3.org/TR/xml/#d0e804)
          We don't need to check the value; it's always URI safe. */
      if (DATA_ATTR.test(lcName)) ; else if (ARIA_ATTR.test(lcName)) ; else if (
        (dropAttributes && dropAttributes.includes(lcName)) ||
        (allowAttributes &&
          allowAttributes.length &&
          !allowAttributes.includes(lcName))
      ) {
        return false;

        /* Check value is safe. First, is attr inert? If so, is safe */
      } else if (URI_SAFE_ATTRIBUTES.includes(lcName)) ; else if (IS_ALLOWED_URI.test(value.replace(ATTR_WHITESPACE, ''))) ; else if (
        (lcName === 'src' || lcName === 'xlink:href' || lcName === 'href') &&
        lcTag !== 'script' &&
        value.indexOf('data:') === 0 &&
        DATA_URI_TAGS.includes(lcTag)
      ) ; else if (!IS_SCRIPT_OR_DATA.test(value.replace(ATTR_WHITESPACE, ''))) ; else if (!value) ; else {
        return false;
      }

      return true;
    }

    /**
     * Public method to check if an tag is valid.
     * isValidElement
     *
     * @param  {string} tag Tag name of containing element.
     * @return {Boolean} Returns true if `value` is valid. Otherwise, returns false.
     */
    isValidElement(tag) {
      const { allowElements, blockElements, dropElements } = this.config;
      const lcTag = tag.toLowerCase();

      if (DROP_ELEMENTS.includes(lcTag)) {
        return false;
      }

      if (
        (dropElements && dropElements.includes(lcTag)) ||
        (blockElements && blockElements.includes(lcTag)) ||
        (allowElements && allowElements.length && !allowElements.includes(lcTag))
      ) {
        return false;
      }

      return true;
    }

    /**
     * sanitizeAttributes
     *
     * @protect attributes
     * @protect nodeName
     * @protect removeAttribute
     * @protect setAttribute
     *
     * @param  {Node} currentNode to sanitize
     */
    [sanitizeAttributes](currentNode) {
      const { allowAttributes } = this.config;

      const lcTag = currentNode.nodeName;
      let attr, value, lcName, l;

      /* Execute a hook if present */
      this[executeHook]('beforeSanitizeAttributes', currentNode, null);

      const { attributes } = currentNode;

      /* Check if we have attributes; if not we might have a text node */
      if (!attributes) {
        return;
      }

      const hookEvent = {
        name: '',
        value: '',
        keep: true,
        allowAttributes
      };
      l = attributes.length;

      /* Go backwards over all attributes; safely remove bad ones */
      while (l--) {
        attr = attributes[l];
        const { name } = attr;
        value = attr.value.trim();
        lcName = name;

        /* Execute a hook if present */
        hookEvent.name = lcName;
        hookEvent.value = value;
        hookEvent.keep = undefined; // Allows developers to see this is a property they can set
        this[executeHook]('uponSanitizeAttribute', currentNode, hookEvent);
        value = hookEvent.value;
        /* Did the hooks approve of the attribute? */
        if (hookEvent.keep) {
          continue;
        }

        /* Is `value` valid for this attribute? */

        if (!this.isValidAttribute(lcTag, lcName, value)) {
          removeAttribute(name, currentNode);
        }
      }

      /* Execute a hook if present */
      this[executeHook]('afterSanitizeAttributes', currentNode, null);
    }

    /**
     * sanitizeShadowDOM
     *
     * @param  {DocumentFragment} fragment to iterate over recursively
     */
    [sanitizeShadowDOM](fragment) {
      let shadowNode;
      const shadowIterator = createIterator(fragment);

      /* Execute a hook if present */
      this[executeHook]('beforeSanitizeShadowDOM', fragment, null);

      while ((shadowNode = shadowIterator.nextNode())) {
        /* Execute a hook if present */
        this[executeHook]('uponSanitizeShadowNode', shadowNode, null);

        /* Sanitize tags and elements */
        if (this[sanitizeElements](shadowNode)) {
          continue;
        }

        /* Deep shadow DOM detected */
        if (shadowNode.content instanceof DocumentFragment) {
          this[sanitizeShadowDOM](shadowNode.content);
        }

        /* Check attributes, sanitize if necessary */
        this[sanitizeAttributes](shadowNode);
      }

      /* Execute a hook if present */
      this[executeHook]('afterSanitizeShadowDOM', fragment, null);
    }

    /**
     * sanitize
     *
     * @param   {String} dirty string
     * @return  {HTMLElement}
     */
    [sanitizeString](dirty, RETURN_DOM) {
      dirty = `${dirty}`;
      const body = initDocument(dirty);

      if (!body) {
        return RETURN_DOM ? document$1.createDocumentFragment() : '';
      }

      const nodeIterator = createIterator(body);
      let currentNode;

      while ((currentNode = nodeIterator.nextNode())) {
        /* Sanitize tags and elements */
        if (this[sanitizeElements](currentNode)) {
          continue;
        }

        /* Shadow DOM detected, sanitize it */
        if (currentNode.content instanceof DocumentFragment) {
          this[sanitizeShadowDOM](currentNode.content);
        }

        /* Check attributes, sanitize if necessary */
        this[sanitizeAttributes](currentNode);
      }

      /* Return sanitized string or DOM */
      if (RETURN_DOM) {
        const returnNode = body.ownerDocument.createDocumentFragment();

        if (body) {
          while (body.firstChild) {
            returnNode.appendChild(body.firstChild);
          }
        }

        return returnNode;
      }

      const serializedHTML = body.innerHTML;

      return serializedHTML;
    }

    /**
     * sanitizeToString
     * Public method providing core sanitation functionality
     *
     * @param   {String} dirty string
     * @return  {DocumentFragment}
     */
    sanitize(dirty) {
      return this[sanitizeString](dirty, true);
    }

    /**
     * sanitizeToString
     * Public method providing core sanitation functionality
     *
     * @param   {String} dirty string
     * @return  {String}
     */
    sanitizeToString(dirty) {
      return this[sanitizeString](dirty);
    }
  }

  function langUtils() {
    return lang;
  }

  langUtils.cacheResult = true;

  function browserUtils() {
    return browser;
  }

  browserUtils.cacheResult = true;

  var dependencies = {
    ...bridge,
    ...traps,
    ...initializers,
    langUtils,
    browserUtils,
    createCSPValidation(dependencies, ...args) {
      return new CSPValidation(...args);
    },
    createSanitizer(dependencies, ...args) {
      return new Sanitizer(...args);
    },
    isJavaScriptType(dependencies, ...args) {
      return isJavaScriptType(...args);
    }
  };

  let INDEX = 0;
  const BRIDGE = Symbol('bridge');
  const webSandboxs = new WeakMap();

  function getParentWebSandboxElement(view) {
    let current = view;
    do {
      current = current.getRootNode().host;
      if (current && webSandboxs.has(current)) {
        return current;
      }
    } while (current);
    return null;
  }

  function createInjector({
    csp,
    debug,
    documentView,
    id,
    parent,
    title,
    windowView
  }) {
    const compartment = createCompartment();
    const evaluate = (value, context) =>
      compartment.evaluate(
        typeof value === 'function' ? `(${value})` : value,
        context
      );
    const animationFrameList = [];
    const customElements = new Map();
    const global = compartment.global;
    const injector = new Injector();
    const intervalList = [];
    const nativeCache = new WeakMap();
    const timeoutList = [];
    const virtualCache = new WeakMap();

    const properties = {
      animationFrameList,
      csp,
      customElements,
      debug,
      documentView,
      evaluate,
      global,
      id,
      injector,
      intervalList,
      nativeCache,
      parent,
      timeoutList,
      title,
      virtualCache,
      windowView
    };

    Object.keys(properties).forEach(name => {
      injector.register(name, properties[name]);
    });

    const stack = Object.keys(dependencies);
    const register = name => {
      const func = dependencies[name];
      const cacheResult = func.cacheResult;
      const resolve = injector.resolve(func);
      const value = cacheResult ? resolve() : resolve;
      const index = stack.indexOf(name);
      injector.register(name, value);
      stack.splice(index, 1);

      return value;
    };

    injector.fallback = function injectorFallback(name) {
      if (!Object.prototype.hasOwnProperty.call(dependencies, name)) {
        throw new Error(`Injector: Can't resolve ${name}`);
      }
      return register(name);
    };

    while (stack.length) {
      const name = stack[0];
      register(name);
    }

    return injector;
  }

  class WebSandbox {
    constructor(view, options = {}) {
      if (!view.isConnected) {
        throw new Error(`Elements must be inserted into the DOM`);
      }

      const config = {
        csp: defaultCsp,
        ...options,
        parent: view.ownerDocument.defaultView,
        windowView: view,
        documentView: view.attachShadow({ mode: 'closed' }),
        id: view.id || `#${INDEX}`,
        title: view.title || view.name
      };

      config.csp = parsePolicy(config.csp);

      const parentWebSandboxElement = getParentWebSandboxElement(view);

      // 继承父沙箱的权限
      if (parentWebSandboxElement) {
        // TODO 这里取到的父属性可能不正确
        const parentWebSandbox = webSandboxs.get(parentWebSandboxElement);
        const parentId = parentWebSandbox[BRIDGE].id;
        const parentDebug = parentWebSandbox.debug;
        const parentCsp = parentWebSandbox[BRIDGE].csp;

        config.debug = parentDebug;
        config.id = `${parentId}.${config.id}`;

        Object.keys(config.csp).forEach(key => {
          if (!parentCsp[key]) {
            delete config.csp[key];
          } else {
            config.csp[key].forEach((value, index) => {
              if (!parentCsp[key].includes(value)) {
                config.csp[key].splice(index, 1);
              }
            });
          }
        });
      }

      const injector = createInjector(config);

      injector.resolve(
        ({
          browserUtils: { scriptSourceLoader },
          csp,
          debug,
          evaluate,
          global,
          id,
          installBOMInterfaces,
          installContainLayout,
          installHooks,
          installDefaultNodes,
          installEsTraps,
          installView,
          installWindowProperties,
          toNativeAny,
          toVirtualAny
        }) => {
          // 生成 Window 与 Document
          installView();
          // 生成 BOM 全局接口
          installBOMInterfaces();
          // 生成 BOM 全局对象自身属性
          installWindowProperties();
          // 生成 ECMAScript 内置对象代理
          installEsTraps();
          // 生成默认的 DOM 节点
          installDefaultNodes();
          // 创建独立的渲染容器
          installContainLayout();
          // 生成 CSP 钩子
          installHooks();

          this[BRIDGE] = {
            csp,
            debug,
            evaluate,
            global,
            id,
            scriptSourceLoader,
            toNativeAny,
            toVirtualAny
          };
        }
      )();

      INDEX++;
      webSandboxs.set(view, this);
    }

    get global() {
      return this[BRIDGE].global;
    }

    get evaluate() {
      return this[BRIDGE].evaluate;
    }

    toNative(object) {
      return this[BRIDGE].toNativeAny(object);
    }

    toVirtual(object) {
      return this[BRIDGE].toVirtualAny(object);
    }

    unload() {
      this.global.close();
    }

    importScript(url, context) {
      return this[BRIDGE].scriptSourceLoader(url).then(source =>
        this.evaluate(source, context)
      );
    }
  }

  const FIRST_CONNECTED = Symbol('firstConnect');
  const MOVEING = Symbol('moveing');

  const lifecycleCallbacks = {
    connectedCallback() {
      this.lifecycleCallback('connected');
      if (!this[FIRST_CONNECTED]) {
        this.lifecycleCallback('firstConnected');
        this[FIRST_CONNECTED] = true;
      } else {
        if (this[MOVEING]) {
          this.lifecycleCallback('moved');
        }
      }
    },

    disconnectedCallback() {
      this[MOVEING] = true;
      this.lifecycleCallback('disconnected');
      queueMicrotask(() => {
        if (!this.isConnected) {
          this[MOVEING] = false;
          this.lifecycleCallback('destroyed');
        }
      });
    },

    attributeChangedCallback() {
      this.lifecycleCallback('attributeChanged', ...arguments);
    },

    adoptedCallback() {
      this.lifecycleCallback('adopted', ...arguments);
    }
  };

  /* global window, customElements, Event, URL, HTMLElement */

  const SANDBOX_INSTANCE = Symbol('instance');
  const SANDBOX_AUTOLOAD_DISABLED = Symbol('autoloadDisabled');
  const SANDBOX_CREATE = Symbol('create');
  const SANDBOX_DESTROY = Symbol('destroy');
  const symbols = {
    SANDBOX_INSTANCE,
    SANDBOX_AUTOLOAD_DISABLED,
    SANDBOX_CREATE,
    SANDBOX_DESTROY
  };

  class HTMLWebSandboxElement extends HTMLElement {
    constructor() {
      super();
      Reflect.defineProperty(this, 'debug', {
        configurable: true,
        get() {
          return this.hasAttribute('debug');
        },
        set(value) {
          if (value) {
            this.setAttribute('debug', '');
          } else {
            this.removeAttribute('debug');
          }
        }
      });
    }

    get csp() {
      return this.getAttribute('csp') || '';
    }

    set csp(value) {
      this.setAttribute('csp', value);
    }

    get contentWindow() {
      const sandbox = this[SANDBOX_CREATE]();
      return sandbox ? sandbox.global : null;
    }

    get contentDocument() {
      const sandbox = this[SANDBOX_CREATE]();
      return sandbox ? sandbox.global.document : null;
    }

    get name() {
      return this.getAttribute('name') || '';
    }

    set name(value) {
      this.setAttribute('name', value);
    }

    get src() {
      const value = this.getAttribute('src');
      return value === null ? '' : new URL(value, this.baseURI).href;
    }

    set src(value) {
      this.setAttribute('src', value);
    }

    get text() {
      return this.getAttribute('text') || '';
    }

    set text(value) {
      this.setAttribute('text', value);
    }

    static get observedAttributes() {
      return ['src', 'text'];
    }

    evaluate(source, context) {
      const sandbox = this[SANDBOX_CREATE]();

      if (!sandbox) {
        throw Error('Not initialized');
      }

      return sandbox.evaluate(source, context);
    }

    lifecycleCallback(type) {
      switch (type) {
        case 'attributeChanged':
        case 'firstConnected':
          queueMicrotask(() => {
            this[SANDBOX_CREATE]();
          });
          break;
        case 'destroyed':
          queueMicrotask(() => {
            this[SANDBOX_DESTROY]();
          });
          break;
      }
    }

    [SANDBOX_CREATE]() {
      if (!this.isConnected) {
        return null;
      }

      let sandbox = this[SANDBOX_INSTANCE];

      if (!sandbox) {
        sandbox = new WebSandbox(this, {
          csp: this.csp,
          debug: this.debug,
          id: this.id,
          name: this.name
        });
        this[SANDBOX_INSTANCE] = sandbox;
      }

      if (!this[SANDBOX_AUTOLOAD_DISABLED]) {
        if (this.src) {
          sandbox.importScript(this.src).then(
            () => {
              this.dispatchEvent(new Event('load'));
            },
            error => {
              this.dispatchEvent(new Event('error'));
              queueMicrotask(() => {
                throw error;
              });
            }
          );
          this[SANDBOX_AUTOLOAD_DISABLED] = true;
        } else if (this.text) {
          sandbox.evaluate(this.text);
          this[SANDBOX_AUTOLOAD_DISABLED] = true;
        }
      }

      return sandbox;
    }

    [SANDBOX_DESTROY]() {
      if (this[SANDBOX_INSTANCE]) {
        const sandbox = this[SANDBOX_INSTANCE];
        sandbox.unload();
      }
    }
  }

  Object.assign(HTMLWebSandboxElement, symbols); // 内部 API
  Object.assign(HTMLWebSandboxElement.prototype, lifecycleCallbacks);

  window.HTMLWebSandboxElement = HTMLWebSandboxElement;
  customElements.define('web-sandbox', HTMLWebSandboxElement);

  exports.HTMLWebSandboxElement = HTMLWebSandboxElement;

  Object.defineProperty(exports, '__esModule', { value: true });

})));
//# sourceMappingURL=web-sandbox.umd.debug.js.map
