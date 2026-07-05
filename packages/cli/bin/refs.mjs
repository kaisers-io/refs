#!/usr/bin/env node
import { createRequire } from "node:module";
import { access, chmod, constants, copyFile, lstat, mkdir, readFile, readdir, realpath, rename, rm, rmdir, stat, writeFile } from "node:fs/promises";
import path, { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import fs, { appendFileSync, createReadStream, createWriteStream, existsSync, readFileSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { constants as constants$1, homedir } from "node:os";
import { scheduler, setImmediate, setTimeout } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import childProcess, { ChildProcess, execFile, spawn, spawnSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { aborted, callbackify, debuglog, inspect, promisify, stripVTControlCharacters } from "node:util";
import process$1, { execArgv, execPath, hrtime, platform } from "node:process";
import tty from "node:tty";
import { EventEmitter, addAbortListener, on, once, setMaxListeners } from "node:events";
import { serialize } from "node:v8";
import { finished } from "node:stream/promises";
import { Duplex, PassThrough, Readable, Transform, Writable, getDefaultHighWaterMark } from "node:stream";
import { Buffer as Buffer$1 } from "node:buffer";

//#region \0rolldown/runtime.js
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJSMin = (cb, mod) => () => (mod || (cb((mod = { exports: {} }).exports, mod), cb = null), mod.exports);
var __copyProps = (to, from, except, desc) => {
	if (from && typeof from === "object" || typeof from === "function") {
		for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
			key = keys[i];
			if (!__hasOwnProp.call(to, key) && key !== except) {
				__defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
		}
	}
	return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
	value: mod,
	enumerable: true
}) : target, mod));
var __require = /* #__PURE__ */ (() => createRequire(import.meta.url))();

//#endregion
//#region ../core/src/errors.ts
const EXIT = {
	CONFLICT: 5,
	NOT_FOUND: 4,
	OK: 0,
	UNEXPECTED: 1,
	USAGE: 2,
	VALIDATION: 3
};
var RefsError = class extends Error {
	code;
	exitCode;
	constructor(exitCode, code, message, opts) {
		super(message, opts);
		this.code = code;
		this.exitCode = exitCode;
		this.name = "RefsError";
	}
};
const conflictError = (message) => new RefsError(EXIT.CONFLICT, "conflict", message);
const notFoundError = (message) => new RefsError(EXIT.NOT_FOUND, "not_found", message);
const usageError = (message) => new RefsError(EXIT.USAGE, "usage", message);
const validationError = (message) => new RefsError(EXIT.VALIDATION, "validation", message);
const withStack = (message, stack, verbose) => {
	if (verbose && stack !== void 0) return `${message}\n${stack}`;
	return message;
};
const renderError = (err, opts) => {
	if (err instanceof RefsError) return {
		code: err.code,
		exitCode: err.exitCode,
		message: withStack(err.message, err.stack, opts.verbose)
	};
	if (err instanceof Error) return {
		code: "unexpected",
		exitCode: EXIT.UNEXPECTED,
		message: withStack(err.message, err.stack, opts.verbose)
	};
	return {
		code: "unexpected",
		exitCode: EXIT.UNEXPECTED,
		message: String(err)
	};
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/core.js
var _a$1;
function $constructor(name, initializer, params) {
	function init(inst, def) {
		if (!inst._zod) Object.defineProperty(inst, "_zod", {
			value: {
				def,
				constr: _,
				traits: /* @__PURE__ */ new Set()
			},
			enumerable: false
		});
		if (inst._zod.traits.has(name)) return;
		inst._zod.traits.add(name);
		initializer(inst, def);
		const proto = _.prototype;
		const keys = Object.keys(proto);
		for (let i = 0; i < keys.length; i++) {
			const k = keys[i];
			if (!(k in inst)) inst[k] = proto[k].bind(inst);
		}
	}
	const Parent = params?.Parent ?? Object;
	class Definition extends Parent {}
	Object.defineProperty(Definition, "name", { value: name });
	function _(def) {
		var _a;
		const inst = params?.Parent ? new Definition() : this;
		init(inst, def);
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		for (const fn of inst._zod.deferred) fn();
		return inst;
	}
	Object.defineProperty(_, "init", { value: init });
	Object.defineProperty(_, Symbol.hasInstance, { value: (inst) => {
		if (params?.Parent && inst instanceof params.Parent) return true;
		return inst?._zod?.traits?.has(name);
	} });
	Object.defineProperty(_, "name", { value: name });
	return _;
}
var $ZodAsyncError = class extends Error {
	constructor() {
		super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
	}
};
var $ZodEncodeError = class extends Error {
	constructor(name) {
		super(`Encountered unidirectional transform during encode: ${name}`);
		this.name = "ZodEncodeError";
	}
};
(_a$1 = globalThis).__zod_globalConfig ?? (_a$1.__zod_globalConfig = {});
const globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
	if (newConfig) Object.assign(globalConfig, newConfig);
	return globalConfig;
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/util.js
function getEnumValues(entries) {
	const numericValues = Object.values(entries).filter((v) => typeof v === "number");
	return Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
}
function jsonStringifyReplacer(_, value) {
	if (typeof value === "bigint") return value.toString();
	return value;
}
function cached(getter) {
	return { get value() {
		{
			const value = getter();
			Object.defineProperty(this, "value", { value });
			return value;
		}
		throw new Error("cached value already set");
	} };
}
function nullish(input) {
	return input === null || input === void 0;
}
function cleanRegex(source) {
	const start = source.startsWith("^") ? 1 : 0;
	const end = source.endsWith("$") ? source.length - 1 : source.length;
	return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
	const ratio = val / step;
	const roundedRatio = Math.round(ratio);
	const tolerance = Number.EPSILON * Math.max(Math.abs(ratio), 1);
	if (Math.abs(ratio - roundedRatio) < tolerance) return 0;
	return ratio - roundedRatio;
}
const EVALUATING = /* @__PURE__*/ Symbol("evaluating");
function defineLazy(object, key, getter) {
	let value = void 0;
	Object.defineProperty(object, key, {
		get() {
			if (value === EVALUATING) return;
			if (value === void 0) {
				value = EVALUATING;
				value = getter();
			}
			return value;
		},
		set(v) {
			Object.defineProperty(object, key, { value: v });
		},
		configurable: true
	});
}
function assignProp(target, prop, value) {
	Object.defineProperty(target, prop, {
		value,
		writable: true,
		enumerable: true,
		configurable: true
	});
}
function mergeDefs(...defs) {
	const mergedDescriptors = {};
	for (const def of defs) {
		const descriptors = Object.getOwnPropertyDescriptors(def);
		Object.assign(mergedDescriptors, descriptors);
	}
	return Object.defineProperties({}, mergedDescriptors);
}
function esc(str) {
	return JSON.stringify(str);
}
function slugify(input) {
	return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
const captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {};
function isObject$1(data) {
	return typeof data === "object" && data !== null && !Array.isArray(data);
}
const allowsEval = /* @__PURE__*/ cached(() => {
	if (globalConfig.jitless) return false;
	if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) return false;
	try {
		new Function("");
		return true;
	} catch (_) {
		return false;
	}
});
function isPlainObject$3(o) {
	if (isObject$1(o) === false) return false;
	const ctor = o.constructor;
	if (ctor === void 0) return true;
	if (typeof ctor !== "function") return true;
	const prot = ctor.prototype;
	if (isObject$1(prot) === false) return false;
	if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) return false;
	return true;
}
function shallowClone(o) {
	if (isPlainObject$3(o)) return { ...o };
	if (Array.isArray(o)) return [...o];
	if (o instanceof Map) return new Map(o);
	if (o instanceof Set) return new Set(o);
	return o;
}
const propertyKeyTypes = /* @__PURE__*/ new Set([
	"string",
	"number",
	"symbol"
]);
function escapeRegex(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
	const cl = new inst._zod.constr(def ?? inst._zod.def);
	if (!def || params?.parent) cl._zod.parent = inst;
	return cl;
}
function normalizeParams(_params) {
	const params = _params;
	if (!params) return {};
	if (typeof params === "string") return { error: () => params };
	if (params?.message !== void 0) {
		if (params?.error !== void 0) throw new Error("Cannot specify both `message` and `error` params");
		params.error = params.message;
	}
	delete params.message;
	if (typeof params.error === "string") return {
		...params,
		error: () => params.error
	};
	return params;
}
function optionalKeys(shape) {
	return Object.keys(shape).filter((k) => {
		return shape[k]._zod.optin === "optional" && shape[k]._zod.optout === "optional";
	});
}
const NUMBER_FORMAT_RANGES = {
	safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
	int32: [-2147483648, 2147483647],
	uint32: [0, 4294967295],
	float32: [-34028234663852886e22, 34028234663852886e22],
	float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
};
function pick(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".pick() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = {};
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				newShape[key] = currDef.shape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function omit(schema, mask) {
	const currDef = schema._zod.def;
	const checks = currDef.checks;
	if (checks && checks.length > 0) throw new Error(".omit() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const newShape = { ...schema._zod.def.shape };
			for (const key in mask) {
				if (!(key in currDef.shape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				delete newShape[key];
			}
			assignProp(this, "shape", newShape);
			return newShape;
		},
		checks: []
	}));
}
function extend(schema, shape) {
	if (!isPlainObject$3(shape)) throw new Error("Invalid input to extend: expected a plain object");
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) {
		const existingShape = schema._zod.def.shape;
		for (const key in shape) if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
	}
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function safeExtend(schema, shape) {
	if (!isPlainObject$3(shape)) throw new Error("Invalid input to safeExtend: expected a plain object");
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const _shape = {
			...schema._zod.def.shape,
			...shape
		};
		assignProp(this, "shape", _shape);
		return _shape;
	} }));
}
function merge(a, b) {
	if (a._zod.def.checks?.length) throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
	return clone(a, mergeDefs(a._zod.def, {
		get shape() {
			const _shape = {
				...a._zod.def.shape,
				...b._zod.def.shape
			};
			assignProp(this, "shape", _shape);
			return _shape;
		},
		get catchall() {
			return b._zod.def.catchall;
		},
		checks: b._zod.def.checks ?? []
	}));
}
function partial(Class, schema, mask) {
	const checks = schema._zod.def.checks;
	if (checks && checks.length > 0) throw new Error(".partial() cannot be used on object schemas containing refinements");
	return clone(schema, mergeDefs(schema._zod.def, {
		get shape() {
			const oldShape = schema._zod.def.shape;
			const shape = { ...oldShape };
			if (mask) for (const key in mask) {
				if (!(key in oldShape)) throw new Error(`Unrecognized key: "${key}"`);
				if (!mask[key]) continue;
				shape[key] = Class ? new Class({
					type: "optional",
					innerType: oldShape[key]
				}) : oldShape[key];
			}
			else for (const key in oldShape) shape[key] = Class ? new Class({
				type: "optional",
				innerType: oldShape[key]
			}) : oldShape[key];
			assignProp(this, "shape", shape);
			return shape;
		},
		checks: []
	}));
}
function required(Class, schema, mask) {
	return clone(schema, mergeDefs(schema._zod.def, { get shape() {
		const oldShape = schema._zod.def.shape;
		const shape = { ...oldShape };
		if (mask) for (const key in mask) {
			if (!(key in shape)) throw new Error(`Unrecognized key: "${key}"`);
			if (!mask[key]) continue;
			shape[key] = new Class({
				type: "nonoptional",
				innerType: oldShape[key]
			});
		}
		else for (const key in oldShape) shape[key] = new Class({
			type: "nonoptional",
			innerType: oldShape[key]
		});
		assignProp(this, "shape", shape);
		return shape;
	} }));
}
function aborted$1(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue !== true) return true;
	return false;
}
function explicitlyAborted(x, startIndex = 0) {
	if (x.aborted === true) return true;
	for (let i = startIndex; i < x.issues.length; i++) if (x.issues[i]?.continue === false) return true;
	return false;
}
function prefixIssues(path, issues) {
	return issues.map((iss) => {
		var _a;
		(_a = iss).path ?? (_a.path = []);
		iss.path.unshift(path);
		return iss;
	});
}
function unwrapMessage(message) {
	return typeof message === "string" ? message : message?.message;
}
function finalizeIssue(iss, ctx, config) {
	const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config.customError?.(iss)) ?? unwrapMessage(config.localeError?.(iss)) ?? "Invalid input";
	const { inst: _inst, continue: _continue, input: _input, ...rest } = iss;
	rest.path ?? (rest.path = []);
	rest.message = message;
	if (ctx?.reportInput) rest.input = _input;
	return rest;
}
function getLengthableOrigin(input) {
	if (Array.isArray(input)) return "array";
	if (typeof input === "string") return "string";
	return "unknown";
}
function issue(...args) {
	const [iss, input, inst] = args;
	if (typeof iss === "string") return {
		message: iss,
		code: "custom",
		input,
		inst
	};
	return { ...iss };
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/errors.js
const initializer$1 = (inst, def) => {
	inst.name = "$ZodError";
	Object.defineProperty(inst, "_zod", {
		value: inst._zod,
		enumerable: false
	});
	Object.defineProperty(inst, "issues", {
		value: def,
		enumerable: false
	});
	inst.message = JSON.stringify(def, jsonStringifyReplacer, 2);
	Object.defineProperty(inst, "toString", {
		value: () => inst.message,
		enumerable: false
	});
};
const $ZodError = $constructor("$ZodError", initializer$1);
const $ZodRealError = $constructor("$ZodError", initializer$1, { Parent: Error });
function flattenError(error, mapper = (issue) => issue.message) {
	const fieldErrors = {};
	const formErrors = [];
	for (const sub of error.issues) if (sub.path.length > 0) {
		fieldErrors[sub.path[0]] = fieldErrors[sub.path[0]] || [];
		fieldErrors[sub.path[0]].push(mapper(sub));
	} else formErrors.push(mapper(sub));
	return {
		formErrors,
		fieldErrors
	};
}
function formatError(error, mapper = (issue) => issue.message) {
	const fieldErrors = { _errors: [] };
	const processError = (error, path = []) => {
		for (const issue of error.issues) if (issue.code === "invalid_union" && issue.errors.length) issue.errors.map((issues) => processError({ issues }, [...path, ...issue.path]));
		else if (issue.code === "invalid_key") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else if (issue.code === "invalid_element") processError({ issues: issue.issues }, [...path, ...issue.path]);
		else {
			const fullpath = [...path, ...issue.path];
			if (fullpath.length === 0) fieldErrors._errors.push(mapper(issue));
			else {
				let curr = fieldErrors;
				let i = 0;
				while (i < fullpath.length) {
					const el = fullpath[i];
					if (!(i === fullpath.length - 1)) curr[el] = curr[el] || { _errors: [] };
					else {
						curr[el] = curr[el] || { _errors: [] };
						curr[el]._errors.push(mapper(issue));
					}
					curr = curr[el];
					i++;
				}
			}
		}
	};
	processError(error);
	return fieldErrors;
}
/** Format a ZodError as a human-readable string in the following form.
*
* From
*
* ```ts
* ZodError {
*   issues: [
*     {
*       expected: 'string',
*       code: 'invalid_type',
*       path: [ 'username' ],
*       message: 'Invalid input: expected string'
*     },
*     {
*       expected: 'number',
*       code: 'invalid_type',
*       path: [ 'favoriteNumbers', 1 ],
*       message: 'Invalid input: expected number'
*     }
*   ];
* }
* ```
*
* to
*
* ```
* username
*   ✖ Expected number, received string at "username
* favoriteNumbers[0]
*   ✖ Invalid input: expected number
* ```
*/
function toDotPath(_path) {
	const segs = [];
	const path = _path.map((seg) => typeof seg === "object" ? seg.key : seg);
	for (const seg of path) if (typeof seg === "number") segs.push(`[${seg}]`);
	else if (typeof seg === "symbol") segs.push(`[${JSON.stringify(String(seg))}]`);
	else if (/[^\w$]/.test(seg)) segs.push(`[${JSON.stringify(seg)}]`);
	else {
		if (segs.length) segs.push(".");
		segs.push(seg);
	}
	return segs.join("");
}
function prettifyError(error) {
	const lines = [];
	const issues = [...error.issues].sort((a, b) => (a.path ?? []).length - (b.path ?? []).length);
	for (const issue of issues) {
		lines.push(`✖ ${issue.message}`);
		if (issue.path?.length) lines.push(`  → at ${toDotPath(issue.path)}`);
	}
	return lines.join("\n");
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/parse.js
const _parse = (_Err) => (schema, value, _ctx, _params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	if (result.issues.length) {
		const e = new ((_params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, _params?.callee);
		throw e;
	}
	return result.value;
};
const _parseAsync = (_Err) => async (schema, value, _ctx, params) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	if (result.issues.length) {
		const e = new ((params?.Err) ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
		captureStackTrace(e, params?.callee);
		throw e;
	}
	return result.value;
};
const _safeParse = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: false
	} : { async: false };
	const result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) throw new $ZodAsyncError();
	return result.issues.length ? {
		success: false,
		error: new (_Err ?? $ZodError)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParse$1 = /* @__PURE__*/ _safeParse($ZodRealError);
const _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		async: true
	} : { async: true };
	let result = schema._zod.run({
		value,
		issues: []
	}, ctx);
	if (result instanceof Promise) result = await result;
	return result.issues.length ? {
		success: false,
		error: new _Err(result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	} : {
		success: true,
		data: result.value
	};
};
const safeParseAsync$1 = /* @__PURE__*/ _safeParseAsync($ZodRealError);
const _encode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parse(_Err)(schema, value, ctx);
};
const _decode = (_Err) => (schema, value, _ctx) => {
	return _parse(_Err)(schema, value, _ctx);
};
const _encodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _parseAsync(_Err)(schema, value, ctx);
};
const _decodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _parseAsync(_Err)(schema, value, _ctx);
};
const _safeEncode = (_Err) => (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParse(_Err)(schema, value, ctx);
};
const _safeDecode = (_Err) => (schema, value, _ctx) => {
	return _safeParse(_Err)(schema, value, _ctx);
};
const _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
	const ctx = _ctx ? {
		..._ctx,
		direction: "backward"
	} : { direction: "backward" };
	return _safeParseAsync(_Err)(schema, value, ctx);
};
const _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
	return _safeParseAsync(_Err)(schema, value, _ctx);
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/regexes.js
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const cuid = /^[cC][0-9a-z]{6,}$/;
const cuid2 = /^[0-9a-z]+$/;
const ulid = /^[0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{26}$/;
const xid = /^[0-9a-vA-V]{20}$/;
const ksuid = /^[A-Za-z0-9]{27}$/;
const nanoid = /^[a-zA-Z0-9_-]{21}$/;
/** ISO 8601-1 duration regex. Does not support the 8601-2 extensions like negative durations or fractional/negative components. */
const duration$1 = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
/** A regex for any UUID-like identifier: 8-4-4-4-12 hex pattern */
const guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
/** Returns a regex for validating an RFC 9562/4122 UUID.
*
* @param version Optionally specify a version 1-8. If no version is specified, all versions are supported. */
const uuid = (version) => {
	if (!version) return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
	return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
/** Practical email validation */
const email = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
const _emoji$1 = `^(\\p{Extended_Pictographic}|\\p{Emoji_Component})+$`;
function emoji() {
	return new RegExp(_emoji$1, "u");
}
const ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
const ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
const cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
const cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|::|([0-9a-fA-F]{1,4})?::([0-9a-fA-F]{1,4}:?){0,6})\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
const base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
const base64url = /^[A-Za-z0-9_-]*$/;
const httpProtocol = /^https?$/;
const e164 = /^\+[1-9]\d{6,14}$/;
const dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
const date$1 = /*@__PURE__*/ new RegExp(`^${dateSource}$`);
function timeSource(args) {
	const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
	return typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
}
function time$1(args) {
	return new RegExp(`^${timeSource(args)}$`);
}
function datetime$1(args) {
	const time = timeSource({ precision: args.precision });
	const opts = ["Z"];
	if (args.local) opts.push("");
	if (args.offset) opts.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
	const timeRegex = `${time}(?:${opts.join("|")})`;
	return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
const string$1 = (params) => {
	const regex = params ? `[\\s\\S]{${params?.minimum ?? 0},${params?.maximum ?? ""}}` : `[\\s\\S]*`;
	return new RegExp(`^${regex}$`);
};
const integer = /^-?\d+$/;
const number$1 = /^-?\d+(?:\.\d+)?$/;
const lowercase = /^[^A-Z]*$/;
const uppercase = /^[^a-z]*$/;

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/checks.js
const $ZodCheck = /*@__PURE__*/ $constructor("$ZodCheck", (inst, def) => {
	var _a;
	inst._zod ?? (inst._zod = {});
	inst._zod.def = def;
	(_a = inst._zod).onattach ?? (_a.onattach = []);
});
const numericOriginMap = {
	number: "number",
	bigint: "bigint",
	object: "date"
};
const $ZodCheckLessThan = /*@__PURE__*/ $constructor("$ZodCheckLessThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.maximum : bag.exclusiveMaximum) ?? Number.POSITIVE_INFINITY;
		if (def.value < curr) if (def.inclusive) bag.maximum = def.value;
		else bag.exclusiveMaximum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value <= def.value : payload.value < def.value) return;
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckGreaterThan = /*@__PURE__*/ $constructor("$ZodCheckGreaterThan", (inst, def) => {
	$ZodCheck.init(inst, def);
	const origin = numericOriginMap[typeof def.value];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		const curr = (def.inclusive ? bag.minimum : bag.exclusiveMinimum) ?? Number.NEGATIVE_INFINITY;
		if (def.value > curr) if (def.inclusive) bag.minimum = def.value;
		else bag.exclusiveMinimum = def.value;
	});
	inst._zod.check = (payload) => {
		if (def.inclusive ? payload.value >= def.value : payload.value > def.value) return;
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
			input: payload.value,
			inclusive: def.inclusive,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMultipleOf = /*@__PURE__*/ $constructor("$ZodCheckMultipleOf", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		var _a;
		(_a = inst._zod.bag).multipleOf ?? (_a.multipleOf = def.value);
	});
	inst._zod.check = (payload) => {
		if (typeof payload.value !== typeof def.value) throw new Error("Cannot mix number and bigint in multiple_of check.");
		if (typeof payload.value === "bigint" ? payload.value % def.value === BigInt(0) : floatSafeRemainder(payload.value, def.value) === 0) return;
		payload.issues.push({
			origin: typeof payload.value,
			code: "not_multiple_of",
			divisor: def.value,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckNumberFormat = /*@__PURE__*/ $constructor("$ZodCheckNumberFormat", (inst, def) => {
	$ZodCheck.init(inst, def);
	def.format = def.format || "float64";
	const isInt = def.format?.includes("int");
	const origin = isInt ? "int" : "number";
	const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		bag.minimum = minimum;
		bag.maximum = maximum;
		if (isInt) bag.pattern = integer;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (isInt) {
			if (!Number.isInteger(input)) {
				payload.issues.push({
					expected: origin,
					format: def.format,
					code: "invalid_type",
					continue: false,
					input,
					inst
				});
				return;
			}
			if (!Number.isSafeInteger(input)) {
				if (input > 0) payload.issues.push({
					input,
					code: "too_big",
					maximum: Number.MAX_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				else payload.issues.push({
					input,
					code: "too_small",
					minimum: Number.MIN_SAFE_INTEGER,
					note: "Integers must be within the safe integer range.",
					inst,
					origin,
					inclusive: true,
					continue: !def.abort
				});
				return;
			}
		}
		if (input < minimum) payload.issues.push({
			origin: "number",
			input,
			code: "too_small",
			minimum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
		if (input > maximum) payload.issues.push({
			origin: "number",
			input,
			code: "too_big",
			maximum,
			inclusive: true,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMaxLength = /*@__PURE__*/ $constructor("$ZodCheckMaxLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.maximum ?? Number.POSITIVE_INFINITY;
		if (def.maximum < curr) inst._zod.bag.maximum = def.maximum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length <= def.maximum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_big",
			maximum: def.maximum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckMinLength = /*@__PURE__*/ $constructor("$ZodCheckMinLength", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const curr = inst._zod.bag.minimum ?? Number.NEGATIVE_INFINITY;
		if (def.minimum > curr) inst._zod.bag.minimum = def.minimum;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		if (input.length >= def.minimum) return;
		const origin = getLengthableOrigin(input);
		payload.issues.push({
			origin,
			code: "too_small",
			minimum: def.minimum,
			inclusive: true,
			input,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLengthEquals = /*@__PURE__*/ $constructor("$ZodCheckLengthEquals", (inst, def) => {
	var _a;
	$ZodCheck.init(inst, def);
	(_a = inst._zod.def).when ?? (_a.when = (payload) => {
		const val = payload.value;
		return !nullish(val) && val.length !== void 0;
	});
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.minimum = def.length;
		bag.maximum = def.length;
		bag.length = def.length;
	});
	inst._zod.check = (payload) => {
		const input = payload.value;
		const length = input.length;
		if (length === def.length) return;
		const origin = getLengthableOrigin(input);
		const tooBig = length > def.length;
		payload.issues.push({
			origin,
			...tooBig ? {
				code: "too_big",
				maximum: def.length
			} : {
				code: "too_small",
				minimum: def.length
			},
			inclusive: true,
			exact: true,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStringFormat = /*@__PURE__*/ $constructor("$ZodCheckStringFormat", (inst, def) => {
	var _a, _b;
	$ZodCheck.init(inst, def);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.format = def.format;
		if (def.pattern) {
			bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
			bag.patterns.add(def.pattern);
		}
	});
	if (def.pattern) (_a = inst._zod).check ?? (_a.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: def.format,
			input: payload.value,
			...def.pattern ? { pattern: def.pattern.toString() } : {},
			inst,
			continue: !def.abort
		});
	});
	else (_b = inst._zod).check ?? (_b.check = () => {});
});
const $ZodCheckRegex = /*@__PURE__*/ $constructor("$ZodCheckRegex", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		def.pattern.lastIndex = 0;
		if (def.pattern.test(payload.value)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "regex",
			input: payload.value,
			pattern: def.pattern.toString(),
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckLowerCase = /*@__PURE__*/ $constructor("$ZodCheckLowerCase", (inst, def) => {
	def.pattern ?? (def.pattern = lowercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckUpperCase = /*@__PURE__*/ $constructor("$ZodCheckUpperCase", (inst, def) => {
	def.pattern ?? (def.pattern = uppercase);
	$ZodCheckStringFormat.init(inst, def);
});
const $ZodCheckIncludes = /*@__PURE__*/ $constructor("$ZodCheckIncludes", (inst, def) => {
	$ZodCheck.init(inst, def);
	const escapedRegex = escapeRegex(def.includes);
	const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position}}${escapedRegex}` : escapedRegex);
	def.pattern = pattern;
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.includes(def.includes, def.position)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "includes",
			includes: def.includes,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckStartsWith = /*@__PURE__*/ $constructor("$ZodCheckStartsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.startsWith(def.prefix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "starts_with",
			prefix: def.prefix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckEndsWith = /*@__PURE__*/ $constructor("$ZodCheckEndsWith", (inst, def) => {
	$ZodCheck.init(inst, def);
	const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
	def.pattern ?? (def.pattern = pattern);
	inst._zod.onattach.push((inst) => {
		const bag = inst._zod.bag;
		bag.patterns ?? (bag.patterns = /* @__PURE__ */ new Set());
		bag.patterns.add(pattern);
	});
	inst._zod.check = (payload) => {
		if (payload.value.endsWith(def.suffix)) return;
		payload.issues.push({
			origin: "string",
			code: "invalid_format",
			format: "ends_with",
			suffix: def.suffix,
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodCheckOverwrite = /*@__PURE__*/ $constructor("$ZodCheckOverwrite", (inst, def) => {
	$ZodCheck.init(inst, def);
	inst._zod.check = (payload) => {
		payload.value = def.tx(payload.value);
	};
});

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/doc.js
var Doc = class {
	constructor(args = []) {
		this.content = [];
		this.indent = 0;
		if (this) this.args = args;
	}
	indented(fn) {
		this.indent += 1;
		fn(this);
		this.indent -= 1;
	}
	write(arg) {
		if (typeof arg === "function") {
			arg(this, { execution: "sync" });
			arg(this, { execution: "async" });
			return;
		}
		const lines = arg.split("\n").filter((x) => x);
		const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
		const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
		for (const line of dedented) this.content.push(line);
	}
	compile() {
		const F = Function;
		const args = this?.args;
		const lines = [...(this?.content ?? [``]).map((x) => `  ${x}`)];
		return new F(...args, lines.join("\n"));
	}
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/versions.js
const version$1 = {
	major: 4,
	minor: 4,
	patch: 3
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/schemas.js
const $ZodType = /*@__PURE__*/ $constructor("$ZodType", (inst, def) => {
	var _a;
	inst ?? (inst = {});
	inst._zod.def = def;
	inst._zod.bag = inst._zod.bag || {};
	inst._zod.version = version$1;
	const checks = [...inst._zod.def.checks ?? []];
	if (inst._zod.traits.has("$ZodCheck")) checks.unshift(inst);
	for (const ch of checks) for (const fn of ch._zod.onattach) fn(inst);
	if (checks.length === 0) {
		(_a = inst._zod).deferred ?? (_a.deferred = []);
		inst._zod.deferred?.push(() => {
			inst._zod.run = inst._zod.parse;
		});
	} else {
		const runChecks = (payload, checks, ctx) => {
			let isAborted = aborted$1(payload);
			let asyncResult;
			for (const ch of checks) {
				if (ch._zod.def.when) {
					if (explicitlyAborted(payload)) continue;
					if (!ch._zod.def.when(payload)) continue;
				} else if (isAborted) continue;
				const currLen = payload.issues.length;
				const _ = ch._zod.check(payload);
				if (_ instanceof Promise && ctx?.async === false) throw new $ZodAsyncError();
				if (asyncResult || _ instanceof Promise) asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
					await _;
					if (payload.issues.length === currLen) return;
					if (!isAborted) isAborted = aborted$1(payload, currLen);
				});
				else {
					if (payload.issues.length === currLen) continue;
					if (!isAborted) isAborted = aborted$1(payload, currLen);
				}
			}
			if (asyncResult) return asyncResult.then(() => {
				return payload;
			});
			return payload;
		};
		const handleCanaryResult = (canary, payload, ctx) => {
			if (aborted$1(canary)) {
				canary.aborted = true;
				return canary;
			}
			const checkResult = runChecks(payload, checks, ctx);
			if (checkResult instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return checkResult.then((checkResult) => inst._zod.parse(checkResult, ctx));
			}
			return inst._zod.parse(checkResult, ctx);
		};
		inst._zod.run = (payload, ctx) => {
			if (ctx.skipChecks) return inst._zod.parse(payload, ctx);
			if (ctx.direction === "backward") {
				const canary = inst._zod.parse({
					value: payload.value,
					issues: []
				}, {
					...ctx,
					skipChecks: true
				});
				if (canary instanceof Promise) return canary.then((canary) => {
					return handleCanaryResult(canary, payload, ctx);
				});
				return handleCanaryResult(canary, payload, ctx);
			}
			const result = inst._zod.parse(payload, ctx);
			if (result instanceof Promise) {
				if (ctx.async === false) throw new $ZodAsyncError();
				return result.then((result) => runChecks(result, checks, ctx));
			}
			return runChecks(result, checks, ctx);
		};
	}
	defineLazy(inst, "~standard", () => ({
		validate: (value) => {
			try {
				const r = safeParse$1(inst, value);
				return r.success ? { value: r.data } : { issues: r.error?.issues };
			} catch (_) {
				return safeParseAsync$1(inst, value).then((r) => r.success ? { value: r.data } : { issues: r.error?.issues });
			}
		},
		vendor: "zod",
		version: 1
	}));
});
const $ZodString = /*@__PURE__*/ $constructor("$ZodString", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = [...inst?._zod.bag?.patterns ?? []].pop() ?? string$1(inst._zod.bag);
	inst._zod.parse = (payload, _) => {
		if (def.coerce) try {
			payload.value = String(payload.value);
		} catch (_) {}
		if (typeof payload.value === "string") return payload;
		payload.issues.push({
			expected: "string",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
const $ZodStringFormat = /*@__PURE__*/ $constructor("$ZodStringFormat", (inst, def) => {
	$ZodCheckStringFormat.init(inst, def);
	$ZodString.init(inst, def);
});
const $ZodGUID = /*@__PURE__*/ $constructor("$ZodGUID", (inst, def) => {
	def.pattern ?? (def.pattern = guid);
	$ZodStringFormat.init(inst, def);
});
const $ZodUUID = /*@__PURE__*/ $constructor("$ZodUUID", (inst, def) => {
	if (def.version) {
		const v = {
			v1: 1,
			v2: 2,
			v3: 3,
			v4: 4,
			v5: 5,
			v6: 6,
			v7: 7,
			v8: 8
		}[def.version];
		if (v === void 0) throw new Error(`Invalid UUID version: "${def.version}"`);
		def.pattern ?? (def.pattern = uuid(v));
	} else def.pattern ?? (def.pattern = uuid());
	$ZodStringFormat.init(inst, def);
});
const $ZodEmail = /*@__PURE__*/ $constructor("$ZodEmail", (inst, def) => {
	def.pattern ?? (def.pattern = email);
	$ZodStringFormat.init(inst, def);
});
const $ZodURL = /*@__PURE__*/ $constructor("$ZodURL", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		try {
			const trimmed = payload.value.trim();
			if (!def.normalize && def.protocol?.source === httpProtocol.source) {
				if (!/^https?:\/\//i.test(trimmed)) {
					payload.issues.push({
						code: "invalid_format",
						format: "url",
						note: "Invalid URL format",
						input: payload.value,
						inst,
						continue: !def.abort
					});
					return;
				}
			}
			const url = new URL(trimmed);
			if (def.hostname) {
				def.hostname.lastIndex = 0;
				if (!def.hostname.test(url.hostname)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid hostname",
					pattern: def.hostname.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.protocol) {
				def.protocol.lastIndex = 0;
				if (!def.protocol.test(url.protocol.endsWith(":") ? url.protocol.slice(0, -1) : url.protocol)) payload.issues.push({
					code: "invalid_format",
					format: "url",
					note: "Invalid protocol",
					pattern: def.protocol.source,
					input: payload.value,
					inst,
					continue: !def.abort
				});
			}
			if (def.normalize) payload.value = url.href;
			else payload.value = trimmed;
			return;
		} catch (_) {
			payload.issues.push({
				code: "invalid_format",
				format: "url",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodEmoji = /*@__PURE__*/ $constructor("$ZodEmoji", (inst, def) => {
	def.pattern ?? (def.pattern = emoji());
	$ZodStringFormat.init(inst, def);
});
const $ZodNanoID = /*@__PURE__*/ $constructor("$ZodNanoID", (inst, def) => {
	def.pattern ?? (def.pattern = nanoid);
	$ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link $ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const $ZodCUID = /*@__PURE__*/ $constructor("$ZodCUID", (inst, def) => {
	def.pattern ?? (def.pattern = cuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodCUID2 = /*@__PURE__*/ $constructor("$ZodCUID2", (inst, def) => {
	def.pattern ?? (def.pattern = cuid2);
	$ZodStringFormat.init(inst, def);
});
const $ZodULID = /*@__PURE__*/ $constructor("$ZodULID", (inst, def) => {
	def.pattern ?? (def.pattern = ulid);
	$ZodStringFormat.init(inst, def);
});
const $ZodXID = /*@__PURE__*/ $constructor("$ZodXID", (inst, def) => {
	def.pattern ?? (def.pattern = xid);
	$ZodStringFormat.init(inst, def);
});
const $ZodKSUID = /*@__PURE__*/ $constructor("$ZodKSUID", (inst, def) => {
	def.pattern ?? (def.pattern = ksuid);
	$ZodStringFormat.init(inst, def);
});
const $ZodISODateTime = /*@__PURE__*/ $constructor("$ZodISODateTime", (inst, def) => {
	def.pattern ?? (def.pattern = datetime$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODate = /*@__PURE__*/ $constructor("$ZodISODate", (inst, def) => {
	def.pattern ?? (def.pattern = date$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodISOTime = /*@__PURE__*/ $constructor("$ZodISOTime", (inst, def) => {
	def.pattern ?? (def.pattern = time$1(def));
	$ZodStringFormat.init(inst, def);
});
const $ZodISODuration = /*@__PURE__*/ $constructor("$ZodISODuration", (inst, def) => {
	def.pattern ?? (def.pattern = duration$1);
	$ZodStringFormat.init(inst, def);
});
const $ZodIPv4 = /*@__PURE__*/ $constructor("$ZodIPv4", (inst, def) => {
	def.pattern ?? (def.pattern = ipv4);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv4`;
});
const $ZodIPv6 = /*@__PURE__*/ $constructor("$ZodIPv6", (inst, def) => {
	def.pattern ?? (def.pattern = ipv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.format = `ipv6`;
	inst._zod.check = (payload) => {
		try {
			new URL(`http://[${payload.value}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "ipv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
const $ZodCIDRv4 = /*@__PURE__*/ $constructor("$ZodCIDRv4", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv4);
	$ZodStringFormat.init(inst, def);
});
const $ZodCIDRv6 = /*@__PURE__*/ $constructor("$ZodCIDRv6", (inst, def) => {
	def.pattern ?? (def.pattern = cidrv6);
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		const parts = payload.value.split("/");
		try {
			if (parts.length !== 2) throw new Error();
			const [address, prefix] = parts;
			if (!prefix) throw new Error();
			const prefixNum = Number(prefix);
			if (`${prefixNum}` !== prefix) throw new Error();
			if (prefixNum < 0 || prefixNum > 128) throw new Error();
			new URL(`http://[${address}]`);
		} catch {
			payload.issues.push({
				code: "invalid_format",
				format: "cidrv6",
				input: payload.value,
				inst,
				continue: !def.abort
			});
		}
	};
});
function isValidBase64(data) {
	if (data === "") return true;
	if (/\s/.test(data)) return false;
	if (data.length % 4 !== 0) return false;
	try {
		atob(data);
		return true;
	} catch {
		return false;
	}
}
const $ZodBase64 = /*@__PURE__*/ $constructor("$ZodBase64", (inst, def) => {
	def.pattern ?? (def.pattern = base64);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64";
	inst._zod.check = (payload) => {
		if (isValidBase64(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
function isValidBase64URL(data) {
	if (!base64url.test(data)) return false;
	const base64 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
	return isValidBase64(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
}
const $ZodBase64URL = /*@__PURE__*/ $constructor("$ZodBase64URL", (inst, def) => {
	def.pattern ?? (def.pattern = base64url);
	$ZodStringFormat.init(inst, def);
	inst._zod.bag.contentEncoding = "base64url";
	inst._zod.check = (payload) => {
		if (isValidBase64URL(payload.value)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "base64url",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodE164 = /*@__PURE__*/ $constructor("$ZodE164", (inst, def) => {
	def.pattern ?? (def.pattern = e164);
	$ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
	try {
		const tokensParts = token.split(".");
		if (tokensParts.length !== 3) return false;
		const [header] = tokensParts;
		if (!header) return false;
		const parsedHeader = JSON.parse(atob(header));
		if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT") return false;
		if (!parsedHeader.alg) return false;
		if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm)) return false;
		return true;
	} catch {
		return false;
	}
}
const $ZodJWT = /*@__PURE__*/ $constructor("$ZodJWT", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	inst._zod.check = (payload) => {
		if (isValidJWT(payload.value, def.alg)) return;
		payload.issues.push({
			code: "invalid_format",
			format: "jwt",
			input: payload.value,
			inst,
			continue: !def.abort
		});
	};
});
const $ZodNumber = /*@__PURE__*/ $constructor("$ZodNumber", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.pattern = inst._zod.bag.pattern ?? number$1;
	inst._zod.parse = (payload, _ctx) => {
		if (def.coerce) try {
			payload.value = Number(payload.value);
		} catch (_) {}
		const input = payload.value;
		if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) return payload;
		const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? "Infinity" : void 0 : void 0;
		payload.issues.push({
			expected: "number",
			code: "invalid_type",
			input,
			inst,
			...received ? { received } : {}
		});
		return payload;
	};
});
const $ZodNumberFormat = /*@__PURE__*/ $constructor("$ZodNumberFormat", (inst, def) => {
	$ZodCheckNumberFormat.init(inst, def);
	$ZodNumber.init(inst, def);
});
const $ZodUnknown = /*@__PURE__*/ $constructor("$ZodUnknown", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload) => payload;
});
const $ZodNever = /*@__PURE__*/ $constructor("$ZodNever", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _ctx) => {
		payload.issues.push({
			expected: "never",
			code: "invalid_type",
			input: payload.value,
			inst
		});
		return payload;
	};
});
function handleArrayResult(result, final, index) {
	if (result.issues.length) final.issues.push(...prefixIssues(index, result.issues));
	final.value[index] = result.value;
}
const $ZodArray = /*@__PURE__*/ $constructor("$ZodArray", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!Array.isArray(input)) {
			payload.issues.push({
				expected: "array",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = Array(input.length);
		const proms = [];
		for (let i = 0; i < input.length; i++) {
			const item = input[i];
			const result = def.element._zod.run({
				value: item,
				issues: []
			}, ctx);
			if (result instanceof Promise) proms.push(result.then((result) => handleArrayResult(result, payload, i)));
			else handleArrayResult(result, payload, i);
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
function handlePropertyResult(result, final, key, input, isOptionalIn, isOptionalOut) {
	const isPresent = key in input;
	if (result.issues.length) {
		if (isOptionalIn && isOptionalOut && !isPresent) return;
		final.issues.push(...prefixIssues(key, result.issues));
	}
	if (!isPresent && !isOptionalIn) {
		if (!result.issues.length) final.issues.push({
			code: "invalid_type",
			expected: "nonoptional",
			input: void 0,
			path: [key]
		});
		return;
	}
	if (result.value === void 0) {
		if (isPresent) final.value[key] = void 0;
	} else final.value[key] = result.value;
}
function normalizeDef(def) {
	const keys = Object.keys(def.shape);
	for (const k of keys) if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) throw new Error(`Invalid element at key "${k}": expected a Zod schema`);
	const okeys = optionalKeys(def.shape);
	return {
		...def,
		keys,
		keySet: new Set(keys),
		numKeys: keys.length,
		optionalKeys: new Set(okeys)
	};
}
function handleCatchall(proms, input, payload, ctx, def, inst) {
	const unrecognized = [];
	const keySet = def.keySet;
	const _catchall = def.catchall._zod;
	const t = _catchall.def.type;
	const isOptionalIn = _catchall.optin === "optional";
	const isOptionalOut = _catchall.optout === "optional";
	for (const key in input) {
		if (key === "__proto__") continue;
		if (keySet.has(key)) continue;
		if (t === "never") {
			unrecognized.push(key);
			continue;
		}
		const r = _catchall.run({
			value: input[key],
			issues: []
		}, ctx);
		if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
		else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
	}
	if (unrecognized.length) payload.issues.push({
		code: "unrecognized_keys",
		keys: unrecognized,
		input,
		inst
	});
	if (!proms.length) return payload;
	return Promise.all(proms).then(() => {
		return payload;
	});
}
const $ZodObject = /*@__PURE__*/ $constructor("$ZodObject", (inst, def) => {
	$ZodType.init(inst, def);
	if (!Object.getOwnPropertyDescriptor(def, "shape")?.get) {
		const sh = def.shape;
		Object.defineProperty(def, "shape", { get: () => {
			const newSh = { ...sh };
			Object.defineProperty(def, "shape", { value: newSh });
			return newSh;
		} });
	}
	const _normalized = cached(() => normalizeDef(def));
	defineLazy(inst._zod, "propValues", () => {
		const shape = def.shape;
		const propValues = {};
		for (const key in shape) {
			const field = shape[key]._zod;
			if (field.values) {
				propValues[key] ?? (propValues[key] = /* @__PURE__ */ new Set());
				for (const v of field.values) propValues[key].add(v);
			}
		}
		return propValues;
	});
	const isObject = isObject$1;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		payload.value = {};
		const proms = [];
		const shape = value.shape;
		for (const key of value.keys) {
			const el = shape[key];
			const isOptionalIn = el._zod.optin === "optional";
			const isOptionalOut = el._zod.optout === "optional";
			const r = el._zod.run({
				value: input[key],
				issues: []
			}, ctx);
			if (r instanceof Promise) proms.push(r.then((r) => handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut)));
			else handlePropertyResult(r, payload, key, input, isOptionalIn, isOptionalOut);
		}
		if (!catchall) return proms.length ? Promise.all(proms).then(() => payload) : payload;
		return handleCatchall(proms, input, payload, ctx, _normalized.value, inst);
	};
});
const $ZodObjectJIT = /*@__PURE__*/ $constructor("$ZodObjectJIT", (inst, def) => {
	$ZodObject.init(inst, def);
	const superParse = inst._zod.parse;
	const _normalized = cached(() => normalizeDef(def));
	const generateFastpass = (shape) => {
		const doc = new Doc([
			"shape",
			"payload",
			"ctx"
		]);
		const normalized = _normalized.value;
		const parseStr = (key) => {
			const k = esc(key);
			return `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
		};
		doc.write(`const input = payload.value;`);
		const ids = Object.create(null);
		let counter = 0;
		for (const key of normalized.keys) ids[key] = `key_${counter++}`;
		doc.write(`const newResult = {};`);
		for (const key of normalized.keys) {
			const id = ids[key];
			const k = esc(key);
			const schema = shape[key];
			const isOptionalIn = schema?._zod?.optin === "optional";
			const isOptionalOut = schema?._zod?.optout === "optional";
			doc.write(`const ${id} = ${parseStr(key)};`);
			if (isOptionalIn && isOptionalOut) doc.write(`
        if (${id}.issues.length) {
          if (${k} in input) {
            payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
              ...iss,
              path: iss.path ? [${k}, ...iss.path] : [${k}]
            })));
          }
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
			else if (!isOptionalIn) doc.write(`
        const ${id}_present = ${k} in input;
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
        }

        if (${id}_present) {
          if (${id}.value === undefined) {
            newResult[${k}] = undefined;
          } else {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
			else doc.write(`
        if (${id}.issues.length) {
          payload.issues = payload.issues.concat(${id}.issues.map(iss => ({
            ...iss,
            path: iss.path ? [${k}, ...iss.path] : [${k}]
          })));
        }
        
        if (${id}.value === undefined) {
          if (${k} in input) {
            newResult[${k}] = undefined;
          }
        } else {
          newResult[${k}] = ${id}.value;
        }
        
      `);
		}
		doc.write(`payload.value = newResult;`);
		doc.write(`return payload;`);
		const fn = doc.compile();
		return (payload, ctx) => fn(shape, payload, ctx);
	};
	let fastpass;
	const isObject = isObject$1;
	const jit = !globalConfig.jitless;
	const allowsEval$1 = allowsEval;
	const fastEnabled = jit && allowsEval$1.value;
	const catchall = def.catchall;
	let value;
	inst._zod.parse = (payload, ctx) => {
		value ?? (value = _normalized.value);
		const input = payload.value;
		if (!isObject(input)) {
			payload.issues.push({
				expected: "object",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
			if (!fastpass) fastpass = generateFastpass(def.shape);
			payload = fastpass(payload, ctx);
			if (!catchall) return payload;
			return handleCatchall([], input, payload, ctx, value, inst);
		}
		return superParse(payload, ctx);
	};
});
function handleUnionResults(results, final, inst, ctx) {
	for (const result of results) if (result.issues.length === 0) {
		final.value = result.value;
		return final;
	}
	const nonaborted = results.filter((r) => !aborted$1(r));
	if (nonaborted.length === 1) {
		final.value = nonaborted[0].value;
		return nonaborted[0];
	}
	final.issues.push({
		code: "invalid_union",
		input: final.value,
		inst,
		errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
	});
	return final;
}
const $ZodUnion = /*@__PURE__*/ $constructor("$ZodUnion", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.options.some((o) => o._zod.optin === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "optout", () => def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
	defineLazy(inst._zod, "values", () => {
		if (def.options.every((o) => o._zod.values)) return new Set(def.options.flatMap((option) => Array.from(option._zod.values)));
	});
	defineLazy(inst._zod, "pattern", () => {
		if (def.options.every((o) => o._zod.pattern)) {
			const patterns = def.options.map((o) => o._zod.pattern);
			return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
		}
	});
	const first = def.options.length === 1 ? def.options[0]._zod.run : null;
	inst._zod.parse = (payload, ctx) => {
		if (first) return first(payload, ctx);
		let async = false;
		const results = [];
		for (const option of def.options) {
			const result = option._zod.run({
				value: payload.value,
				issues: []
			}, ctx);
			if (result instanceof Promise) {
				results.push(result);
				async = true;
			} else {
				if (result.issues.length === 0) return result;
				results.push(result);
			}
		}
		if (!async) return handleUnionResults(results, payload, inst, ctx);
		return Promise.all(results).then((results) => {
			return handleUnionResults(results, payload, inst, ctx);
		});
	};
});
const $ZodIntersection = /*@__PURE__*/ $constructor("$ZodIntersection", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		const left = def.left._zod.run({
			value: input,
			issues: []
		}, ctx);
		const right = def.right._zod.run({
			value: input,
			issues: []
		}, ctx);
		if (left instanceof Promise || right instanceof Promise) return Promise.all([left, right]).then(([left, right]) => {
			return handleIntersectionResults(payload, left, right);
		});
		return handleIntersectionResults(payload, left, right);
	};
});
function mergeValues(a, b) {
	if (a === b) return {
		valid: true,
		data: a
	};
	if (a instanceof Date && b instanceof Date && +a === +b) return {
		valid: true,
		data: a
	};
	if (isPlainObject$3(a) && isPlainObject$3(b)) {
		const bKeys = Object.keys(b);
		const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
		const newObj = {
			...a,
			...b
		};
		for (const key of sharedKeys) {
			const sharedValue = mergeValues(a[key], b[key]);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
			};
			newObj[key] = sharedValue.data;
		}
		return {
			valid: true,
			data: newObj
		};
	}
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return {
			valid: false,
			mergeErrorPath: []
		};
		const newArray = [];
		for (let index = 0; index < a.length; index++) {
			const itemA = a[index];
			const itemB = b[index];
			const sharedValue = mergeValues(itemA, itemB);
			if (!sharedValue.valid) return {
				valid: false,
				mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
			};
			newArray.push(sharedValue.data);
		}
		return {
			valid: true,
			data: newArray
		};
	}
	return {
		valid: false,
		mergeErrorPath: []
	};
}
function handleIntersectionResults(result, left, right) {
	const unrecKeys = /* @__PURE__ */ new Map();
	let unrecIssue;
	for (const iss of left.issues) if (iss.code === "unrecognized_keys") {
		unrecIssue ?? (unrecIssue = iss);
		for (const k of iss.keys) {
			if (!unrecKeys.has(k)) unrecKeys.set(k, {});
			unrecKeys.get(k).l = true;
		}
	} else result.issues.push(iss);
	for (const iss of right.issues) if (iss.code === "unrecognized_keys") for (const k of iss.keys) {
		if (!unrecKeys.has(k)) unrecKeys.set(k, {});
		unrecKeys.get(k).r = true;
	}
	else result.issues.push(iss);
	const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
	if (bothKeys.length && unrecIssue) result.issues.push({
		...unrecIssue,
		keys: bothKeys
	});
	if (aborted$1(result)) return result;
	const merged = mergeValues(left.value, right.value);
	if (!merged.valid) throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
	result.value = merged.data;
	return result;
}
const $ZodRecord = /*@__PURE__*/ $constructor("$ZodRecord", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, ctx) => {
		const input = payload.value;
		if (!isPlainObject$3(input)) {
			payload.issues.push({
				expected: "record",
				code: "invalid_type",
				input,
				inst
			});
			return payload;
		}
		const proms = [];
		const values = def.keyType._zod.values;
		if (values) {
			payload.value = {};
			const recordKeys = /* @__PURE__ */ new Set();
			for (const key of values) if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
				recordKeys.add(typeof key === "number" ? key.toString() : key);
				const keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (keyResult.issues.length) {
					payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const outKey = keyResult.value;
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[outKey] = result.value;
				}
			}
			let unrecognized;
			for (const key in input) if (!recordKeys.has(key)) {
				unrecognized = unrecognized ?? [];
				unrecognized.push(key);
			}
			if (unrecognized && unrecognized.length > 0) payload.issues.push({
				code: "unrecognized_keys",
				input,
				inst,
				keys: unrecognized
			});
		} else {
			payload.value = {};
			for (const key of Reflect.ownKeys(input)) {
				if (key === "__proto__") continue;
				if (!Object.prototype.propertyIsEnumerable.call(input, key)) continue;
				let keyResult = def.keyType._zod.run({
					value: key,
					issues: []
				}, ctx);
				if (keyResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
				if (typeof key === "string" && number$1.test(key) && keyResult.issues.length) {
					const retryResult = def.keyType._zod.run({
						value: Number(key),
						issues: []
					}, ctx);
					if (retryResult instanceof Promise) throw new Error("Async schemas not supported in object keys currently");
					if (retryResult.issues.length === 0) keyResult = retryResult;
				}
				if (keyResult.issues.length) {
					if (def.mode === "loose") payload.value[key] = input[key];
					else payload.issues.push({
						code: "invalid_key",
						origin: "record",
						issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
						input: key,
						path: [key],
						inst
					});
					continue;
				}
				const result = def.valueType._zod.run({
					value: input[key],
					issues: []
				}, ctx);
				if (result instanceof Promise) proms.push(result.then((result) => {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}));
				else {
					if (result.issues.length) payload.issues.push(...prefixIssues(key, result.issues));
					payload.value[keyResult.value] = result.value;
				}
			}
		}
		if (proms.length) return Promise.all(proms).then(() => payload);
		return payload;
	};
});
const $ZodEnum = /*@__PURE__*/ $constructor("$ZodEnum", (inst, def) => {
	$ZodType.init(inst, def);
	const values = getEnumValues(def.entries);
	const valuesSet = new Set(values);
	inst._zod.values = valuesSet;
	inst._zod.pattern = new RegExp(`^(${values.filter((k) => propertyKeyTypes.has(typeof k)).map((o) => typeof o === "string" ? escapeRegex(o) : o.toString()).join("|")})$`);
	inst._zod.parse = (payload, _ctx) => {
		const input = payload.value;
		if (valuesSet.has(input)) return payload;
		payload.issues.push({
			code: "invalid_value",
			values,
			input,
			inst
		});
		return payload;
	};
});
const $ZodTransform = /*@__PURE__*/ $constructor("$ZodTransform", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		const _out = def.transform(payload.value, payload);
		if (ctx.async) return (_out instanceof Promise ? _out : Promise.resolve(_out)).then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		if (_out instanceof Promise) throw new $ZodAsyncError();
		payload.value = _out;
		payload.fallback = true;
		return payload;
	};
});
function handleOptionalResult(result, input) {
	if (input === void 0 && (result.issues.length || result.fallback)) return {
		issues: [],
		value: void 0
	};
	return result;
}
const $ZodOptional = /*@__PURE__*/ $constructor("$ZodOptional", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	inst._zod.optout = "optional";
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, void 0]) : void 0;
	});
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (def.innerType._zod.optin === "optional") {
			const input = payload.value;
			const result = def.innerType._zod.run(payload, ctx);
			if (result instanceof Promise) return result.then((r) => handleOptionalResult(r, input));
			return handleOptionalResult(result, input);
		}
		if (payload.value === void 0) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodExactOptional = /*@__PURE__*/ $constructor("$ZodExactOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "pattern", () => def.innerType._zod.pattern);
	inst._zod.parse = (payload, ctx) => {
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNullable = /*@__PURE__*/ $constructor("$ZodNullable", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "optin", () => def.innerType._zod.optin);
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "pattern", () => {
		const pattern = def.innerType._zod.pattern;
		return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
	});
	defineLazy(inst._zod, "values", () => {
		return def.innerType._zod.values ? /* @__PURE__ */ new Set([...def.innerType._zod.values, null]) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		if (payload.value === null) return payload;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodDefault = /*@__PURE__*/ $constructor("$ZodDefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) {
			payload.value = def.defaultValue;
			/**
			* $ZodDefault returns the default value immediately in forward direction.
			* It doesn't pass the default value into the validator ("prefault"). There's no reason to pass the default value through validation. The validity of the default is enforced by TypeScript statically. Otherwise, it's the responsibility of the user to ensure the default is valid. In the case of pipes with divergent in/out types, you can specify the default on the `in` schema of your ZodPipe to set a "prefault" for the pipe.   */
			return payload;
		}
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleDefaultResult(result, def));
		return handleDefaultResult(result, def);
	};
});
function handleDefaultResult(payload, def) {
	if (payload.value === void 0) payload.value = def.defaultValue;
	return payload;
}
const $ZodPrefault = /*@__PURE__*/ $constructor("$ZodPrefault", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		if (payload.value === void 0) payload.value = def.defaultValue;
		return def.innerType._zod.run(payload, ctx);
	};
});
const $ZodNonOptional = /*@__PURE__*/ $constructor("$ZodNonOptional", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => {
		const v = def.innerType._zod.values;
		return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
	});
	inst._zod.parse = (payload, ctx) => {
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => handleNonOptionalResult(result, inst));
		return handleNonOptionalResult(result, inst);
	};
});
function handleNonOptionalResult(payload, inst) {
	if (!payload.issues.length && payload.value === void 0) payload.issues.push({
		code: "invalid_type",
		expected: "nonoptional",
		input: payload.value,
		inst
	});
	return payload;
}
const $ZodCatch = /*@__PURE__*/ $constructor("$ZodCatch", (inst, def) => {
	$ZodType.init(inst, def);
	inst._zod.optin = "optional";
	defineLazy(inst._zod, "optout", () => def.innerType._zod.optout);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then((result) => {
			payload.value = result.value;
			if (result.issues.length) {
				payload.value = def.catchValue({
					...payload,
					error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
					input: payload.value
				});
				payload.issues = [];
				payload.fallback = true;
			}
			return payload;
		});
		payload.value = result.value;
		if (result.issues.length) {
			payload.value = def.catchValue({
				...payload,
				error: { issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config())) },
				input: payload.value
			});
			payload.issues = [];
			payload.fallback = true;
		}
		return payload;
	};
});
const $ZodPipe = /*@__PURE__*/ $constructor("$ZodPipe", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "values", () => def.in._zod.values);
	defineLazy(inst._zod, "optin", () => def.in._zod.optin);
	defineLazy(inst._zod, "optout", () => def.out._zod.optout);
	defineLazy(inst._zod, "propValues", () => def.in._zod.propValues);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") {
			const right = def.out._zod.run(payload, ctx);
			if (right instanceof Promise) return right.then((right) => handlePipeResult(right, def.in, ctx));
			return handlePipeResult(right, def.in, ctx);
		}
		const left = def.in._zod.run(payload, ctx);
		if (left instanceof Promise) return left.then((left) => handlePipeResult(left, def.out, ctx));
		return handlePipeResult(left, def.out, ctx);
	};
});
function handlePipeResult(left, next, ctx) {
	if (left.issues.length) {
		left.aborted = true;
		return left;
	}
	return next._zod.run({
		value: left.value,
		issues: left.issues,
		fallback: left.fallback
	}, ctx);
}
const $ZodPreprocess = /*@__PURE__*/ $constructor("$ZodPreprocess", (inst, def) => {
	$ZodPipe.init(inst, def);
});
const $ZodReadonly = /*@__PURE__*/ $constructor("$ZodReadonly", (inst, def) => {
	$ZodType.init(inst, def);
	defineLazy(inst._zod, "propValues", () => def.innerType._zod.propValues);
	defineLazy(inst._zod, "values", () => def.innerType._zod.values);
	defineLazy(inst._zod, "optin", () => def.innerType?._zod?.optin);
	defineLazy(inst._zod, "optout", () => def.innerType?._zod?.optout);
	inst._zod.parse = (payload, ctx) => {
		if (ctx.direction === "backward") return def.innerType._zod.run(payload, ctx);
		const result = def.innerType._zod.run(payload, ctx);
		if (result instanceof Promise) return result.then(handleReadonlyResult);
		return handleReadonlyResult(result);
	};
});
function handleReadonlyResult(payload) {
	payload.value = Object.freeze(payload.value);
	return payload;
}
const $ZodCustom = /*@__PURE__*/ $constructor("$ZodCustom", (inst, def) => {
	$ZodCheck.init(inst, def);
	$ZodType.init(inst, def);
	inst._zod.parse = (payload, _) => {
		return payload;
	};
	inst._zod.check = (payload) => {
		const input = payload.value;
		const r = def.fn(input);
		if (r instanceof Promise) return r.then((r) => handleRefineResult(r, payload, input, inst));
		handleRefineResult(r, payload, input, inst);
	};
});
function handleRefineResult(result, payload, input, inst) {
	if (!result) {
		const _iss = {
			code: "custom",
			input,
			inst,
			path: [...inst._zod.def.path ?? []],
			continue: !inst._zod.def.abort
		};
		if (inst._zod.def.params) _iss.params = inst._zod.def.params;
		payload.issues.push(issue(_iss));
	}
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/registries.js
var _a;
var $ZodRegistry = class {
	constructor() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
	}
	add(schema, ..._meta) {
		const meta = _meta[0];
		this._map.set(schema, meta);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.set(meta.id, schema);
		return this;
	}
	clear() {
		this._map = /* @__PURE__ */ new WeakMap();
		this._idmap = /* @__PURE__ */ new Map();
		return this;
	}
	remove(schema) {
		const meta = this._map.get(schema);
		if (meta && typeof meta === "object" && "id" in meta) this._idmap.delete(meta.id);
		this._map.delete(schema);
		return this;
	}
	get(schema) {
		const p = schema._zod.parent;
		if (p) {
			const pm = { ...this.get(p) ?? {} };
			delete pm.id;
			const f = {
				...pm,
				...this._map.get(schema)
			};
			return Object.keys(f).length ? f : void 0;
		}
		return this._map.get(schema);
	}
	has(schema) {
		return this._map.has(schema);
	}
};
function registry() {
	return new $ZodRegistry();
}
(_a = globalThis).__zod_globalRegistry ?? (_a.__zod_globalRegistry = registry());
const globalRegistry = globalThis.__zod_globalRegistry;

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/api.js
// @__NO_SIDE_EFFECTS__
function _string(Class, params) {
	return new Class({
		type: "string",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _email(Class, params) {
	return new Class({
		type: "string",
		format: "email",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _guid(Class, params) {
	return new Class({
		type: "string",
		format: "guid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v4",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v6",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class, params) {
	return new Class({
		type: "string",
		format: "uuid",
		check: "string_format",
		abort: false,
		version: "v7",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _url(Class, params) {
	return new Class({
		type: "string",
		format: "url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _emoji(Class, params) {
	return new Class({
		type: "string",
		format: "emoji",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class, params) {
	return new Class({
		type: "string",
		format: "nanoid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link _cuid2} instead.
* See https://github.com/paralleldrive/cuid.
*/
// @__NO_SIDE_EFFECTS__
function _cuid(Class, params) {
	return new Class({
		type: "string",
		format: "cuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class, params) {
	return new Class({
		type: "string",
		format: "cuid2",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class, params) {
	return new Class({
		type: "string",
		format: "ulid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _xid(Class, params) {
	return new Class({
		type: "string",
		format: "xid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class, params) {
	return new Class({
		type: "string",
		format: "ksuid",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class, params) {
	return new Class({
		type: "string",
		format: "ipv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class, params) {
	return new Class({
		type: "string",
		format: "ipv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv4",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class, params) {
	return new Class({
		type: "string",
		format: "cidrv6",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64(Class, params) {
	return new Class({
		type: "string",
		format: "base64",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class, params) {
	return new Class({
		type: "string",
		format: "base64url",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _e164(Class, params) {
	return new Class({
		type: "string",
		format: "e164",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class, params) {
	return new Class({
		type: "string",
		format: "jwt",
		check: "string_format",
		abort: false,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class, params) {
	return new Class({
		type: "string",
		format: "datetime",
		check: "string_format",
		offset: false,
		local: false,
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class, params) {
	return new Class({
		type: "string",
		format: "date",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class, params) {
	return new Class({
		type: "string",
		format: "time",
		check: "string_format",
		precision: null,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class, params) {
	return new Class({
		type: "string",
		format: "duration",
		check: "string_format",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _number(Class, params) {
	return new Class({
		type: "number",
		checks: [],
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _int(Class, params) {
	return new Class({
		type: "number",
		check: "number_format",
		abort: false,
		format: "safeint",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class) {
	return new Class({ type: "unknown" });
}
// @__NO_SIDE_EFFECTS__
function _never(Class, params) {
	return new Class({
		type: "never",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
	return new $ZodCheckLessThan({
		check: "less_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: false
	});
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
	return new $ZodCheckGreaterThan({
		check: "greater_than",
		...normalizeParams(params),
		value,
		inclusive: true
	});
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
	return new $ZodCheckMultipleOf({
		check: "multiple_of",
		...normalizeParams(params),
		value
	});
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
	return new $ZodCheckMaxLength({
		check: "max_length",
		...normalizeParams(params),
		maximum
	});
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
	return new $ZodCheckMinLength({
		check: "min_length",
		...normalizeParams(params),
		minimum
	});
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
	return new $ZodCheckLengthEquals({
		check: "length_equals",
		...normalizeParams(params),
		length
	});
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
	return new $ZodCheckRegex({
		check: "string_format",
		format: "regex",
		...normalizeParams(params),
		pattern
	});
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
	return new $ZodCheckLowerCase({
		check: "string_format",
		format: "lowercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
	return new $ZodCheckUpperCase({
		check: "string_format",
		format: "uppercase",
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
	return new $ZodCheckIncludes({
		check: "string_format",
		format: "includes",
		...normalizeParams(params),
		includes
	});
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
	return new $ZodCheckStartsWith({
		check: "string_format",
		format: "starts_with",
		...normalizeParams(params),
		prefix
	});
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
	return new $ZodCheckEndsWith({
		check: "string_format",
		format: "ends_with",
		...normalizeParams(params),
		suffix
	});
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
	return new $ZodCheckOverwrite({
		check: "overwrite",
		tx
	});
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
	return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
	return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
	return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
	return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class, element, params) {
	return new Class({
		type: "array",
		element,
		...normalizeParams(params)
	});
}
// @__NO_SIDE_EFFECTS__
function _refine(Class, fn, _params) {
	return new Class({
		type: "custom",
		check: "custom",
		fn,
		...normalizeParams(_params)
	});
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
	const ch = /* @__PURE__ */ _check((payload) => {
		payload.addIssue = (issue$2) => {
			if (typeof issue$2 === "string") payload.issues.push(issue(issue$2, payload.value, ch._zod.def));
			else {
				const _issue = issue$2;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = ch);
				_issue.continue ?? (_issue.continue = !ch._zod.def.abort);
				payload.issues.push(issue(_issue));
			}
		};
		return fn(payload.value, payload);
	}, params);
	return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
	const ch = new $ZodCheck({
		check: "custom",
		...normalizeParams(params)
	});
	ch._zod.check = fn;
	return ch;
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/to-json-schema.js
function initializeContext(params) {
	let target = params?.target ?? "draft-2020-12";
	if (target === "draft-4") target = "draft-04";
	if (target === "draft-7") target = "draft-07";
	return {
		processors: params.processors ?? {},
		metadataRegistry: params?.metadata ?? globalRegistry,
		target,
		unrepresentable: params?.unrepresentable ?? "throw",
		override: params?.override ?? (() => {}),
		io: params?.io ?? "output",
		counter: 0,
		seen: /* @__PURE__ */ new Map(),
		cycles: params?.cycles ?? "ref",
		reused: params?.reused ?? "inline",
		external: params?.external ?? void 0
	};
}
function process$3(schema, ctx, _params = {
	path: [],
	schemaPath: []
}) {
	var _a;
	const def = schema._zod.def;
	const seen = ctx.seen.get(schema);
	if (seen) {
		seen.count++;
		if (_params.schemaPath.includes(schema)) seen.cycle = _params.path;
		return seen.schema;
	}
	const result = {
		schema: {},
		count: 1,
		cycle: void 0,
		path: _params.path
	};
	ctx.seen.set(schema, result);
	const overrideSchema = schema._zod.toJSONSchema?.();
	if (overrideSchema) result.schema = overrideSchema;
	else {
		const params = {
			..._params,
			schemaPath: [..._params.schemaPath, schema],
			path: _params.path
		};
		if (schema._zod.processJSONSchema) schema._zod.processJSONSchema(ctx, result.schema, params);
		else {
			const _json = result.schema;
			const processor = ctx.processors[def.type];
			if (!processor) throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
			processor(schema, ctx, _json, params);
		}
		const parent = schema._zod.parent;
		if (parent) {
			if (!result.ref) result.ref = parent;
			process$3(parent, ctx, params);
			ctx.seen.get(parent).isParent = true;
		}
	}
	const meta = ctx.metadataRegistry.get(schema);
	if (meta) Object.assign(result.schema, meta);
	if (ctx.io === "input" && isTransforming(schema)) {
		delete result.schema.examples;
		delete result.schema.default;
	}
	if (ctx.io === "input" && "_prefault" in result.schema) (_a = result.schema).default ?? (_a.default = result.schema._prefault);
	delete result.schema._prefault;
	return ctx.seen.get(schema).schema;
}
function extractDefs(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const idToSchema = /* @__PURE__ */ new Map();
	for (const entry of ctx.seen.entries()) {
		const id = ctx.metadataRegistry.get(entry[0])?.id;
		if (id) {
			const existing = idToSchema.get(id);
			if (existing && existing !== entry[0]) throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
			idToSchema.set(id, entry[0]);
		}
	}
	const makeURI = (entry) => {
		const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
		if (ctx.external) {
			const externalId = ctx.external.registry.get(entry[0])?.id;
			const uriGenerator = ctx.external.uri ?? ((id) => id);
			if (externalId) return { ref: uriGenerator(externalId) };
			const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
			entry[1].defId = id;
			return {
				defId: id,
				ref: `${uriGenerator("__shared")}#/${defsSegment}/${id}`
			};
		}
		if (entry[1] === root) return { ref: "#" };
		const defUriPrefix = `#/${defsSegment}/`;
		const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
		return {
			defId,
			ref: defUriPrefix + defId
		};
	};
	const extractToDef = (entry) => {
		if (entry[1].schema.$ref) return;
		const seen = entry[1];
		const { ref, defId } = makeURI(entry);
		seen.def = { ...seen.schema };
		if (defId) seen.defId = defId;
		const schema = seen.schema;
		for (const key in schema) delete schema[key];
		schema.$ref = ref;
	};
	if (ctx.cycles === "throw") for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.cycle) throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
	}
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (schema === entry[0]) {
			extractToDef(entry);
			continue;
		}
		if (ctx.external) {
			const ext = ctx.external.registry.get(entry[0])?.id;
			if (schema !== entry[0] && ext) {
				extractToDef(entry);
				continue;
			}
		}
		if (ctx.metadataRegistry.get(entry[0])?.id) {
			extractToDef(entry);
			continue;
		}
		if (seen.cycle) {
			extractToDef(entry);
			continue;
		}
		if (seen.count > 1) {
			if (ctx.reused === "ref") {
				extractToDef(entry);
				continue;
			}
		}
	}
}
function finalize(ctx, schema) {
	const root = ctx.seen.get(schema);
	if (!root) throw new Error("Unprocessed schema. This is a bug in Zod.");
	const flattenRef = (zodSchema) => {
		const seen = ctx.seen.get(zodSchema);
		if (seen.ref === null) return;
		const schema = seen.def ?? seen.schema;
		const _cached = { ...schema };
		const ref = seen.ref;
		seen.ref = null;
		if (ref) {
			flattenRef(ref);
			const refSeen = ctx.seen.get(ref);
			const refSchema = refSeen.schema;
			if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
				schema.allOf = schema.allOf ?? [];
				schema.allOf.push(refSchema);
			} else Object.assign(schema, refSchema);
			Object.assign(schema, _cached);
			if (zodSchema._zod.parent === ref) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (!(key in _cached)) delete schema[key];
			}
			if (refSchema.$ref && refSeen.def) for (const key in schema) {
				if (key === "$ref" || key === "allOf") continue;
				if (key in refSeen.def && JSON.stringify(schema[key]) === JSON.stringify(refSeen.def[key])) delete schema[key];
			}
		}
		const parent = zodSchema._zod.parent;
		if (parent && parent !== ref) {
			flattenRef(parent);
			const parentSeen = ctx.seen.get(parent);
			if (parentSeen?.schema.$ref) {
				schema.$ref = parentSeen.schema.$ref;
				if (parentSeen.def) for (const key in schema) {
					if (key === "$ref" || key === "allOf") continue;
					if (key in parentSeen.def && JSON.stringify(schema[key]) === JSON.stringify(parentSeen.def[key])) delete schema[key];
				}
			}
		}
		ctx.override({
			zodSchema,
			jsonSchema: schema,
			path: seen.path ?? []
		});
	};
	for (const entry of [...ctx.seen.entries()].reverse()) flattenRef(entry[0]);
	const result = {};
	if (ctx.target === "draft-2020-12") result.$schema = "https://json-schema.org/draft/2020-12/schema";
	else if (ctx.target === "draft-07") result.$schema = "http://json-schema.org/draft-07/schema#";
	else if (ctx.target === "draft-04") result.$schema = "http://json-schema.org/draft-04/schema#";
	else if (ctx.target === "openapi-3.0") {}
	if (ctx.external?.uri) {
		const id = ctx.external.registry.get(schema)?.id;
		if (!id) throw new Error("Schema is missing an `id` property");
		result.$id = ctx.external.uri(id);
	}
	Object.assign(result, root.def ?? root.schema);
	const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
	if (rootMetaId !== void 0 && result.id === rootMetaId) delete result.id;
	const defs = ctx.external?.defs ?? {};
	for (const entry of ctx.seen.entries()) {
		const seen = entry[1];
		if (seen.def && seen.defId) {
			if (seen.def.id === seen.defId) delete seen.def.id;
			defs[seen.defId] = seen.def;
		}
	}
	if (ctx.external) {} else if (Object.keys(defs).length > 0) if (ctx.target === "draft-2020-12") result.$defs = defs;
	else result.definitions = defs;
	try {
		const finalized = JSON.parse(JSON.stringify(result));
		Object.defineProperty(finalized, "~standard", {
			value: {
				...schema["~standard"],
				jsonSchema: {
					input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
					output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
				}
			},
			enumerable: false,
			writable: false
		});
		return finalized;
	} catch (_err) {
		throw new Error("Error converting schema to JSON.");
	}
}
function isTransforming(_schema, _ctx) {
	const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
	if (ctx.seen.has(_schema)) return false;
	ctx.seen.add(_schema);
	const def = _schema._zod.def;
	if (def.type === "transform") return true;
	if (def.type === "array") return isTransforming(def.element, ctx);
	if (def.type === "set") return isTransforming(def.valueType, ctx);
	if (def.type === "lazy") return isTransforming(def.getter(), ctx);
	if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault") return isTransforming(def.innerType, ctx);
	if (def.type === "intersection") return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
	if (def.type === "record" || def.type === "map") return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
	if (def.type === "pipe") {
		if (_schema._zod.traits.has("$ZodCodec")) return true;
		return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
	}
	if (def.type === "object") {
		for (const key in def.shape) if (isTransforming(def.shape[key], ctx)) return true;
		return false;
	}
	if (def.type === "union") {
		for (const option of def.options) if (isTransforming(option, ctx)) return true;
		return false;
	}
	if (def.type === "tuple") {
		for (const item of def.items) if (isTransforming(item, ctx)) return true;
		if (def.rest && isTransforming(def.rest, ctx)) return true;
		return false;
	}
	return false;
}
/**
* Creates a toJSONSchema method for a schema instance.
* This encapsulates the logic of initializing context, processing, extracting defs, and finalizing.
*/
const createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
	const ctx = initializeContext({
		...params,
		processors
	});
	process$3(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};
const createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
	const { libraryOptions, target } = params ?? {};
	const ctx = initializeContext({
		...libraryOptions ?? {},
		target,
		io,
		processors
	});
	process$3(schema, ctx);
	extractDefs(ctx, schema);
	return finalize(ctx, schema);
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/core/json-schema-processors.js
const formatMap = {
	guid: "uuid",
	url: "uri",
	datetime: "date-time",
	json_string: "json-string",
	regex: ""
};
const stringProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	json.type = "string";
	const { minimum, maximum, format, patterns, contentEncoding } = schema._zod.bag;
	if (typeof minimum === "number") json.minLength = minimum;
	if (typeof maximum === "number") json.maxLength = maximum;
	if (format) {
		json.format = formatMap[format] ?? format;
		if (json.format === "") delete json.format;
		if (format === "time") delete json.format;
	}
	if (contentEncoding) json.contentEncoding = contentEncoding;
	if (patterns && patterns.size > 0) {
		const regexes = [...patterns];
		if (regexes.length === 1) json.pattern = regexes[0].source;
		else if (regexes.length > 1) json.allOf = [...regexes.map((regex) => ({
			...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
			pattern: regex.source
		}))];
	}
};
const numberProcessor = (schema, ctx, _json, _params) => {
	const json = _json;
	const { minimum, maximum, format, multipleOf, exclusiveMaximum, exclusiveMinimum } = schema._zod.bag;
	if (typeof format === "string" && format.includes("int")) json.type = "integer";
	else json.type = "number";
	const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
	const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
	const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
	if (exMin) if (legacy) {
		json.minimum = exclusiveMinimum;
		json.exclusiveMinimum = true;
	} else json.exclusiveMinimum = exclusiveMinimum;
	else if (typeof minimum === "number") json.minimum = minimum;
	if (exMax) if (legacy) {
		json.maximum = exclusiveMaximum;
		json.exclusiveMaximum = true;
	} else json.exclusiveMaximum = exclusiveMaximum;
	else if (typeof maximum === "number") json.maximum = maximum;
	if (typeof multipleOf === "number") json.multipleOf = multipleOf;
};
const neverProcessor = (_schema, _ctx, json, _params) => {
	json.not = {};
};
const unknownProcessor = (_schema, _ctx, _json, _params) => {};
const enumProcessor = (schema, _ctx, json, _params) => {
	const def = schema._zod.def;
	const values = getEnumValues(def.entries);
	if (values.every((v) => typeof v === "number")) json.type = "number";
	if (values.every((v) => typeof v === "string")) json.type = "string";
	json.enum = values;
};
const customProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Custom types cannot be represented in JSON Schema");
};
const transformProcessor = (_schema, ctx, _json, _params) => {
	if (ctx.unrepresentable === "throw") throw new Error("Transforms cannot be represented in JSON Schema");
};
const arrayProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	const { minimum, maximum } = schema._zod.bag;
	if (typeof minimum === "number") json.minItems = minimum;
	if (typeof maximum === "number") json.maxItems = maximum;
	json.type = "array";
	json.items = process$3(def.element, ctx, {
		...params,
		path: [...params.path, "items"]
	});
};
const objectProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	json.properties = {};
	const shape = def.shape;
	for (const key in shape) json.properties[key] = process$3(shape[key], ctx, {
		...params,
		path: [
			...params.path,
			"properties",
			key
		]
	});
	const allKeys = new Set(Object.keys(shape));
	const requiredKeys = new Set([...allKeys].filter((key) => {
		const v = def.shape[key]._zod;
		if (ctx.io === "input") return v.optin === void 0;
		else return v.optout === void 0;
	}));
	if (requiredKeys.size > 0) json.required = Array.from(requiredKeys);
	if (def.catchall?._zod.def.type === "never") json.additionalProperties = false;
	else if (!def.catchall) {
		if (ctx.io === "output") json.additionalProperties = false;
	} else if (def.catchall) json.additionalProperties = process$3(def.catchall, ctx, {
		...params,
		path: [...params.path, "additionalProperties"]
	});
};
const unionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const isExclusive = def.inclusive === false;
	const options = def.options.map((x, i) => process$3(x, ctx, {
		...params,
		path: [
			...params.path,
			isExclusive ? "oneOf" : "anyOf",
			i
		]
	}));
	if (isExclusive) json.oneOf = options;
	else json.anyOf = options;
};
const intersectionProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const a = process$3(def.left, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			0
		]
	});
	const b = process$3(def.right, ctx, {
		...params,
		path: [
			...params.path,
			"allOf",
			1
		]
	});
	const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
	json.allOf = [...isSimpleIntersection(a) ? a.allOf : [a], ...isSimpleIntersection(b) ? b.allOf : [b]];
};
const recordProcessor = (schema, ctx, _json, params) => {
	const json = _json;
	const def = schema._zod.def;
	json.type = "object";
	const keyType = def.keyType;
	const patterns = keyType._zod.bag?.patterns;
	if (def.mode === "loose" && patterns && patterns.size > 0) {
		const valueSchema = process$3(def.valueType, ctx, {
			...params,
			path: [
				...params.path,
				"patternProperties",
				"*"
			]
		});
		json.patternProperties = {};
		for (const pattern of patterns) json.patternProperties[pattern.source] = valueSchema;
	} else {
		if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") json.propertyNames = process$3(def.keyType, ctx, {
			...params,
			path: [...params.path, "propertyNames"]
		});
		json.additionalProperties = process$3(def.valueType, ctx, {
			...params,
			path: [...params.path, "additionalProperties"]
		});
	}
	const keyValues = keyType._zod.values;
	if (keyValues) {
		const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
		if (validKeyValues.length > 0) json.required = validKeyValues;
	}
};
const nullableProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	const inner = process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	if (ctx.target === "openapi-3.0") {
		seen.ref = def.innerType;
		json.nullable = true;
	} else json.anyOf = [inner, { type: "null" }];
};
const nonoptionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};
const defaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.default = JSON.parse(JSON.stringify(def.defaultValue));
};
const prefaultProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	if (ctx.io === "input") json._prefault = JSON.parse(JSON.stringify(def.defaultValue));
};
const catchProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	let catchValue;
	try {
		catchValue = def.catchValue(void 0);
	} catch {
		throw new Error("Dynamic catch values are not supported in JSON Schema");
	}
	json.default = catchValue;
};
const pipeProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	const inIsTransform = def.in._zod.traits.has("$ZodTransform");
	const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
	process$3(innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = innerType;
};
const readonlyProcessor = (schema, ctx, json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
	json.readOnly = true;
};
const optionalProcessor = (schema, ctx, _json, params) => {
	const def = schema._zod.def;
	process$3(def.innerType, ctx, params);
	const seen = ctx.seen.get(schema);
	seen.ref = def.innerType;
};

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/iso.js
const ZodISODateTime = /*@__PURE__*/ $constructor("ZodISODateTime", (inst, def) => {
	$ZodISODateTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function datetime(params) {
	return _isoDateTime(ZodISODateTime, params);
}
const ZodISODate = /*@__PURE__*/ $constructor("ZodISODate", (inst, def) => {
	$ZodISODate.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function date(params) {
	return _isoDate(ZodISODate, params);
}
const ZodISOTime = /*@__PURE__*/ $constructor("ZodISOTime", (inst, def) => {
	$ZodISOTime.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function time(params) {
	return _isoTime(ZodISOTime, params);
}
const ZodISODuration = /*@__PURE__*/ $constructor("ZodISODuration", (inst, def) => {
	$ZodISODuration.init(inst, def);
	ZodStringFormat.init(inst, def);
});
function duration(params) {
	return _isoDuration(ZodISODuration, params);
}

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/errors.js
const initializer = (inst, issues) => {
	$ZodError.init(inst, issues);
	inst.name = "ZodError";
	Object.defineProperties(inst, {
		format: { value: (mapper) => formatError(inst, mapper) },
		flatten: { value: (mapper) => flattenError(inst, mapper) },
		addIssue: { value: (issue) => {
			inst.issues.push(issue);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		addIssues: { value: (issues) => {
			inst.issues.push(...issues);
			inst.message = JSON.stringify(inst.issues, jsonStringifyReplacer, 2);
		} },
		isEmpty: { get() {
			return inst.issues.length === 0;
		} }
	});
};
const ZodRealError = /*@__PURE__*/ $constructor("ZodError", initializer, { Parent: Error });

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/parse.js
const parse$1 = /* @__PURE__ */ _parse(ZodRealError);
const parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
const safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
const safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
const encode = /* @__PURE__ */ _encode(ZodRealError);
const decode = /* @__PURE__ */ _decode(ZodRealError);
const encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
const decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
const safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
const safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
const safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
const safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

//#endregion
//#region ../../node_modules/.pnpm/zod@4.4.3/node_modules/zod/v4/classic/schemas.js
const _installedGroups = /* @__PURE__ */ new WeakMap();
function _installLazyMethods(inst, group, methods) {
	const proto = Object.getPrototypeOf(inst);
	let installed = _installedGroups.get(proto);
	if (!installed) {
		installed = /* @__PURE__ */ new Set();
		_installedGroups.set(proto, installed);
	}
	if (installed.has(group)) return;
	installed.add(group);
	for (const key in methods) {
		const fn = methods[key];
		Object.defineProperty(proto, key, {
			configurable: true,
			enumerable: false,
			get() {
				const bound = fn.bind(this);
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: bound
				});
				return bound;
			},
			set(v) {
				Object.defineProperty(this, key, {
					configurable: true,
					writable: true,
					enumerable: true,
					value: v
				});
			}
		});
	}
}
const ZodType = /*@__PURE__*/ $constructor("ZodType", (inst, def) => {
	$ZodType.init(inst, def);
	Object.assign(inst["~standard"], { jsonSchema: {
		input: createStandardJSONSchemaMethod(inst, "input"),
		output: createStandardJSONSchemaMethod(inst, "output")
	} });
	inst.toJSONSchema = createToJSONSchemaMethod(inst, {});
	inst.def = def;
	inst.type = def.type;
	Object.defineProperty(inst, "_def", { value: def });
	inst.parse = (data, params) => parse$1(inst, data, params, { callee: inst.parse });
	inst.safeParse = (data, params) => safeParse(inst, data, params);
	inst.parseAsync = async (data, params) => parseAsync(inst, data, params, { callee: inst.parseAsync });
	inst.safeParseAsync = async (data, params) => safeParseAsync(inst, data, params);
	inst.spa = inst.safeParseAsync;
	inst.encode = (data, params) => encode(inst, data, params);
	inst.decode = (data, params) => decode(inst, data, params);
	inst.encodeAsync = async (data, params) => encodeAsync(inst, data, params);
	inst.decodeAsync = async (data, params) => decodeAsync(inst, data, params);
	inst.safeEncode = (data, params) => safeEncode(inst, data, params);
	inst.safeDecode = (data, params) => safeDecode(inst, data, params);
	inst.safeEncodeAsync = async (data, params) => safeEncodeAsync(inst, data, params);
	inst.safeDecodeAsync = async (data, params) => safeDecodeAsync(inst, data, params);
	_installLazyMethods(inst, "ZodType", {
		check(...chks) {
			const def = this.def;
			return this.clone(mergeDefs(def, { checks: [...def.checks ?? [], ...chks.map((ch) => typeof ch === "function" ? { _zod: {
				check: ch,
				def: { check: "custom" },
				onattach: []
			} } : ch)] }), { parent: true });
		},
		with(...chks) {
			return this.check(...chks);
		},
		clone(def, params) {
			return clone(this, def, params);
		},
		brand() {
			return this;
		},
		register(reg, meta) {
			reg.add(this, meta);
			return this;
		},
		refine(check, params) {
			return this.check(refine(check, params));
		},
		superRefine(refinement, params) {
			return this.check(superRefine(refinement, params));
		},
		overwrite(fn) {
			return this.check(_overwrite(fn));
		},
		optional() {
			return optional(this);
		},
		exactOptional() {
			return exactOptional(this);
		},
		nullable() {
			return nullable(this);
		},
		nullish() {
			return optional(nullable(this));
		},
		nonoptional(params) {
			return nonoptional(this, params);
		},
		array() {
			return array(this);
		},
		or(arg) {
			return union([this, arg]);
		},
		and(arg) {
			return intersection(this, arg);
		},
		transform(tx) {
			return pipe(this, transform(tx));
		},
		default(d) {
			return _default(this, d);
		},
		prefault(d) {
			return prefault(this, d);
		},
		catch(params) {
			return _catch(this, params);
		},
		pipe(target) {
			return pipe(this, target);
		},
		readonly() {
			return readonly(this);
		},
		describe(description) {
			const cl = this.clone();
			globalRegistry.add(cl, { description });
			return cl;
		},
		meta(...args) {
			if (args.length === 0) return globalRegistry.get(this);
			const cl = this.clone();
			globalRegistry.add(cl, args[0]);
			return cl;
		},
		isOptional() {
			return this.safeParse(void 0).success;
		},
		isNullable() {
			return this.safeParse(null).success;
		},
		apply(fn) {
			return fn(this);
		}
	});
	Object.defineProperty(inst, "description", {
		get() {
			return globalRegistry.get(inst)?.description;
		},
		configurable: true
	});
	return inst;
});
/** @internal */
const _ZodString = /*@__PURE__*/ $constructor("_ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
	const bag = inst._zod.bag;
	inst.format = bag.format ?? null;
	inst.minLength = bag.minimum ?? null;
	inst.maxLength = bag.maximum ?? null;
	_installLazyMethods(inst, "_ZodString", {
		regex(...args) {
			return this.check(_regex(...args));
		},
		includes(...args) {
			return this.check(_includes(...args));
		},
		startsWith(...args) {
			return this.check(_startsWith(...args));
		},
		endsWith(...args) {
			return this.check(_endsWith(...args));
		},
		min(...args) {
			return this.check(_minLength(...args));
		},
		max(...args) {
			return this.check(_maxLength(...args));
		},
		length(...args) {
			return this.check(_length(...args));
		},
		nonempty(...args) {
			return this.check(_minLength(1, ...args));
		},
		lowercase(params) {
			return this.check(_lowercase(params));
		},
		uppercase(params) {
			return this.check(_uppercase(params));
		},
		trim() {
			return this.check(_trim());
		},
		normalize(...args) {
			return this.check(_normalize(...args));
		},
		toLowerCase() {
			return this.check(_toLowerCase());
		},
		toUpperCase() {
			return this.check(_toUpperCase());
		},
		slugify() {
			return this.check(_slugify());
		}
	});
});
const ZodString = /*@__PURE__*/ $constructor("ZodString", (inst, def) => {
	$ZodString.init(inst, def);
	_ZodString.init(inst, def);
	inst.email = (params) => inst.check(_email(ZodEmail, params));
	inst.url = (params) => inst.check(_url(ZodURL, params));
	inst.jwt = (params) => inst.check(_jwt(ZodJWT, params));
	inst.emoji = (params) => inst.check(_emoji(ZodEmoji, params));
	inst.guid = (params) => inst.check(_guid(ZodGUID, params));
	inst.uuid = (params) => inst.check(_uuid(ZodUUID, params));
	inst.uuidv4 = (params) => inst.check(_uuidv4(ZodUUID, params));
	inst.uuidv6 = (params) => inst.check(_uuidv6(ZodUUID, params));
	inst.uuidv7 = (params) => inst.check(_uuidv7(ZodUUID, params));
	inst.nanoid = (params) => inst.check(_nanoid(ZodNanoID, params));
	inst.guid = (params) => inst.check(_guid(ZodGUID, params));
	inst.cuid = (params) => inst.check(_cuid(ZodCUID, params));
	inst.cuid2 = (params) => inst.check(_cuid2(ZodCUID2, params));
	inst.ulid = (params) => inst.check(_ulid(ZodULID, params));
	inst.base64 = (params) => inst.check(_base64(ZodBase64, params));
	inst.base64url = (params) => inst.check(_base64url(ZodBase64URL, params));
	inst.xid = (params) => inst.check(_xid(ZodXID, params));
	inst.ksuid = (params) => inst.check(_ksuid(ZodKSUID, params));
	inst.ipv4 = (params) => inst.check(_ipv4(ZodIPv4, params));
	inst.ipv6 = (params) => inst.check(_ipv6(ZodIPv6, params));
	inst.cidrv4 = (params) => inst.check(_cidrv4(ZodCIDRv4, params));
	inst.cidrv6 = (params) => inst.check(_cidrv6(ZodCIDRv6, params));
	inst.e164 = (params) => inst.check(_e164(ZodE164, params));
	inst.datetime = (params) => inst.check(datetime(params));
	inst.date = (params) => inst.check(date(params));
	inst.time = (params) => inst.check(time(params));
	inst.duration = (params) => inst.check(duration(params));
});
function string(params) {
	return _string(ZodString, params);
}
const ZodStringFormat = /*@__PURE__*/ $constructor("ZodStringFormat", (inst, def) => {
	$ZodStringFormat.init(inst, def);
	_ZodString.init(inst, def);
});
const ZodEmail = /*@__PURE__*/ $constructor("ZodEmail", (inst, def) => {
	$ZodEmail.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodGUID = /*@__PURE__*/ $constructor("ZodGUID", (inst, def) => {
	$ZodGUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodUUID = /*@__PURE__*/ $constructor("ZodUUID", (inst, def) => {
	$ZodUUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodURL = /*@__PURE__*/ $constructor("ZodURL", (inst, def) => {
	$ZodURL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodEmoji = /*@__PURE__*/ $constructor("ZodEmoji", (inst, def) => {
	$ZodEmoji.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNanoID = /*@__PURE__*/ $constructor("ZodNanoID", (inst, def) => {
	$ZodNanoID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
/**
* @deprecated CUID v1 is deprecated by its authors due to information leakage
* (timestamps embedded in the id). Use {@link ZodCUID2} instead.
* See https://github.com/paralleldrive/cuid.
*/
const ZodCUID = /*@__PURE__*/ $constructor("ZodCUID", (inst, def) => {
	$ZodCUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCUID2 = /*@__PURE__*/ $constructor("ZodCUID2", (inst, def) => {
	$ZodCUID2.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodULID = /*@__PURE__*/ $constructor("ZodULID", (inst, def) => {
	$ZodULID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodXID = /*@__PURE__*/ $constructor("ZodXID", (inst, def) => {
	$ZodXID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodKSUID = /*@__PURE__*/ $constructor("ZodKSUID", (inst, def) => {
	$ZodKSUID.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv4 = /*@__PURE__*/ $constructor("ZodIPv4", (inst, def) => {
	$ZodIPv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodIPv6 = /*@__PURE__*/ $constructor("ZodIPv6", (inst, def) => {
	$ZodIPv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv4 = /*@__PURE__*/ $constructor("ZodCIDRv4", (inst, def) => {
	$ZodCIDRv4.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodCIDRv6 = /*@__PURE__*/ $constructor("ZodCIDRv6", (inst, def) => {
	$ZodCIDRv6.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64 = /*@__PURE__*/ $constructor("ZodBase64", (inst, def) => {
	$ZodBase64.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodBase64URL = /*@__PURE__*/ $constructor("ZodBase64URL", (inst, def) => {
	$ZodBase64URL.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodE164 = /*@__PURE__*/ $constructor("ZodE164", (inst, def) => {
	$ZodE164.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodJWT = /*@__PURE__*/ $constructor("ZodJWT", (inst, def) => {
	$ZodJWT.init(inst, def);
	ZodStringFormat.init(inst, def);
});
const ZodNumber = /*@__PURE__*/ $constructor("ZodNumber", (inst, def) => {
	$ZodNumber.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
	_installLazyMethods(inst, "ZodNumber", {
		gt(value, params) {
			return this.check(_gt(value, params));
		},
		gte(value, params) {
			return this.check(_gte(value, params));
		},
		min(value, params) {
			return this.check(_gte(value, params));
		},
		lt(value, params) {
			return this.check(_lt(value, params));
		},
		lte(value, params) {
			return this.check(_lte(value, params));
		},
		max(value, params) {
			return this.check(_lte(value, params));
		},
		int(params) {
			return this.check(int(params));
		},
		safe(params) {
			return this.check(int(params));
		},
		positive(params) {
			return this.check(_gt(0, params));
		},
		nonnegative(params) {
			return this.check(_gte(0, params));
		},
		negative(params) {
			return this.check(_lt(0, params));
		},
		nonpositive(params) {
			return this.check(_lte(0, params));
		},
		multipleOf(value, params) {
			return this.check(_multipleOf(value, params));
		},
		step(value, params) {
			return this.check(_multipleOf(value, params));
		},
		finite() {
			return this;
		}
	});
	const bag = inst._zod.bag;
	inst.minValue = Math.max(bag.minimum ?? Number.NEGATIVE_INFINITY, bag.exclusiveMinimum ?? Number.NEGATIVE_INFINITY) ?? null;
	inst.maxValue = Math.min(bag.maximum ?? Number.POSITIVE_INFINITY, bag.exclusiveMaximum ?? Number.POSITIVE_INFINITY) ?? null;
	inst.isInt = (bag.format ?? "").includes("int") || Number.isSafeInteger(bag.multipleOf ?? .5);
	inst.isFinite = true;
	inst.format = bag.format ?? null;
});
function number(params) {
	return _number(ZodNumber, params);
}
const ZodNumberFormat = /*@__PURE__*/ $constructor("ZodNumberFormat", (inst, def) => {
	$ZodNumberFormat.init(inst, def);
	ZodNumber.init(inst, def);
});
function int(params) {
	return _int(ZodNumberFormat, params);
}
const ZodUnknown = /*@__PURE__*/ $constructor("ZodUnknown", (inst, def) => {
	$ZodUnknown.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
	return _unknown(ZodUnknown);
}
const ZodNever = /*@__PURE__*/ $constructor("ZodNever", (inst, def) => {
	$ZodNever.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
	return _never(ZodNever, params);
}
const ZodArray = /*@__PURE__*/ $constructor("ZodArray", (inst, def) => {
	$ZodArray.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
	inst.element = def.element;
	_installLazyMethods(inst, "ZodArray", {
		min(n, params) {
			return this.check(_minLength(n, params));
		},
		nonempty(params) {
			return this.check(_minLength(1, params));
		},
		max(n, params) {
			return this.check(_maxLength(n, params));
		},
		length(n, params) {
			return this.check(_length(n, params));
		},
		unwrap() {
			return this.element;
		}
	});
});
function array(element, params) {
	return _array(ZodArray, element, params);
}
const ZodObject = /*@__PURE__*/ $constructor("ZodObject", (inst, def) => {
	$ZodObjectJIT.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
	defineLazy(inst, "shape", () => {
		return def.shape;
	});
	_installLazyMethods(inst, "ZodObject", {
		keyof() {
			return _enum(Object.keys(this._zod.def.shape));
		},
		catchall(catchall) {
			return this.clone({
				...this._zod.def,
				catchall
			});
		},
		passthrough() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		loose() {
			return this.clone({
				...this._zod.def,
				catchall: unknown()
			});
		},
		strict() {
			return this.clone({
				...this._zod.def,
				catchall: never()
			});
		},
		strip() {
			return this.clone({
				...this._zod.def,
				catchall: void 0
			});
		},
		extend(incoming) {
			return extend(this, incoming);
		},
		safeExtend(incoming) {
			return safeExtend(this, incoming);
		},
		merge(other) {
			return merge(this, other);
		},
		pick(mask) {
			return pick(this, mask);
		},
		omit(mask) {
			return omit(this, mask);
		},
		partial(...args) {
			return partial(ZodOptional, this, args[0]);
		},
		required(...args) {
			return required(ZodNonOptional, this, args[0]);
		}
	});
});
function strictObject(shape, params) {
	return new ZodObject({
		type: "object",
		shape,
		catchall: never(),
		...normalizeParams(params)
	});
}
function looseObject(shape, params) {
	return new ZodObject({
		type: "object",
		shape,
		catchall: unknown(),
		...normalizeParams(params)
	});
}
const ZodUnion = /*@__PURE__*/ $constructor("ZodUnion", (inst, def) => {
	$ZodUnion.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
	inst.options = def.options;
});
function union(options, params) {
	return new ZodUnion({
		type: "union",
		options,
		...normalizeParams(params)
	});
}
const ZodIntersection = /*@__PURE__*/ $constructor("ZodIntersection", (inst, def) => {
	$ZodIntersection.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
	return new ZodIntersection({
		type: "intersection",
		left,
		right
	});
}
const ZodRecord = /*@__PURE__*/ $constructor("ZodRecord", (inst, def) => {
	$ZodRecord.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
	inst.keyType = def.keyType;
	inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
	if (!valueType || !valueType._zod) return new ZodRecord({
		type: "record",
		keyType: string(),
		valueType: keyType,
		...normalizeParams(valueType)
	});
	return new ZodRecord({
		type: "record",
		keyType,
		valueType,
		...normalizeParams(params)
	});
}
const ZodEnum = /*@__PURE__*/ $constructor("ZodEnum", (inst, def) => {
	$ZodEnum.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
	inst.enum = def.entries;
	inst.options = Object.values(def.entries);
	const keys = new Set(Object.keys(def.entries));
	inst.extract = (values, params) => {
		const newEntries = {};
		for (const value of values) if (keys.has(value)) newEntries[value] = def.entries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
	inst.exclude = (values, params) => {
		const newEntries = { ...def.entries };
		for (const value of values) if (keys.has(value)) delete newEntries[value];
		else throw new Error(`Key ${value} not found in enum`);
		return new ZodEnum({
			...def,
			checks: [],
			...normalizeParams(params),
			entries: newEntries
		});
	};
});
function _enum(values, params) {
	const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
	return new ZodEnum({
		type: "enum",
		entries,
		...normalizeParams(params)
	});
}
const ZodTransform = /*@__PURE__*/ $constructor("ZodTransform", (inst, def) => {
	$ZodTransform.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
	inst._zod.parse = (payload, _ctx) => {
		if (_ctx.direction === "backward") throw new $ZodEncodeError(inst.constructor.name);
		payload.addIssue = (issue$1) => {
			if (typeof issue$1 === "string") payload.issues.push(issue(issue$1, payload.value, def));
			else {
				const _issue = issue$1;
				if (_issue.fatal) _issue.continue = false;
				_issue.code ?? (_issue.code = "custom");
				_issue.input ?? (_issue.input = payload.value);
				_issue.inst ?? (_issue.inst = inst);
				payload.issues.push(issue(_issue));
			}
		};
		const output = def.transform(payload.value, payload);
		if (output instanceof Promise) return output.then((output) => {
			payload.value = output;
			payload.fallback = true;
			return payload;
		});
		payload.value = output;
		payload.fallback = true;
		return payload;
	};
});
function transform(fn) {
	return new ZodTransform({
		type: "transform",
		transform: fn
	});
}
const ZodOptional = /*@__PURE__*/ $constructor("ZodOptional", (inst, def) => {
	$ZodOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
	return new ZodOptional({
		type: "optional",
		innerType
	});
}
const ZodExactOptional = /*@__PURE__*/ $constructor("ZodExactOptional", (inst, def) => {
	$ZodExactOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
	return new ZodExactOptional({
		type: "optional",
		innerType
	});
}
const ZodNullable = /*@__PURE__*/ $constructor("ZodNullable", (inst, def) => {
	$ZodNullable.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
	return new ZodNullable({
		type: "nullable",
		innerType
	});
}
const ZodDefault = /*@__PURE__*/ $constructor("ZodDefault", (inst, def) => {
	$ZodDefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
	return new ZodDefault({
		type: "default",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodPrefault = /*@__PURE__*/ $constructor("ZodPrefault", (inst, def) => {
	$ZodPrefault.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
	return new ZodPrefault({
		type: "prefault",
		innerType,
		get defaultValue() {
			return typeof defaultValue === "function" ? defaultValue() : shallowClone(defaultValue);
		}
	});
}
const ZodNonOptional = /*@__PURE__*/ $constructor("ZodNonOptional", (inst, def) => {
	$ZodNonOptional.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
	return new ZodNonOptional({
		type: "nonoptional",
		innerType,
		...normalizeParams(params)
	});
}
const ZodCatch = /*@__PURE__*/ $constructor("ZodCatch", (inst, def) => {
	$ZodCatch.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
	inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
	return new ZodCatch({
		type: "catch",
		innerType,
		catchValue: typeof catchValue === "function" ? catchValue : () => catchValue
	});
}
const ZodPipe = /*@__PURE__*/ $constructor("ZodPipe", (inst, def) => {
	$ZodPipe.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
	inst.in = def.in;
	inst.out = def.out;
});
function pipe(in_, out) {
	return new ZodPipe({
		type: "pipe",
		in: in_,
		out
	});
}
const ZodPreprocess = /*@__PURE__*/ $constructor("ZodPreprocess", (inst, def) => {
	ZodPipe.init(inst, def);
	$ZodPreprocess.init(inst, def);
});
const ZodReadonly = /*@__PURE__*/ $constructor("ZodReadonly", (inst, def) => {
	$ZodReadonly.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
	inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
	return new ZodReadonly({
		type: "readonly",
		innerType
	});
}
const ZodCustom = /*@__PURE__*/ $constructor("ZodCustom", (inst, def) => {
	$ZodCustom.init(inst, def);
	ZodType.init(inst, def);
	inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
	return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
	return _superRefine(fn, params);
}
function preprocess(fn, schema) {
	return new ZodPreprocess({
		type: "pipe",
		in: transform(fn),
		out: schema
	});
}

//#endregion
//#region ../core/src/schemas/record-keys.ts
const MIN_LENGTH$3 = 1;
const DANGEROUS_RECORD_KEYS = /* @__PURE__ */ new Set([
	"__proto__",
	"constructor",
	"prototype"
]);
const withValidatedKeys = (keyCheck, message, schema) => preprocess((raw, ctx) => {
	if (raw !== null && typeof raw === "object") {
		for (const key of Reflect.ownKeys(raw)) if (typeof key !== "string" || !keyCheck(key)) ctx.addIssue({
			code: "custom",
			message: message(String(key)),
			path: [String(key)]
		});
	}
	return raw;
}, schema);
const PACKAGE_KEY_ISSUE_MESSAGE = "package key must be non-empty and not \"__proto__\", \"constructor\", or \"prototype\"";
const isSafePackageKey = (key) => key.length >= MIN_LENGTH$3 && !DANGEROUS_RECORD_KEYS.has(key);
const zSafePackagesRecord = (valueSchema) => withValidatedKeys(isSafePackageKey, () => PACKAGE_KEY_ISSUE_MESSAGE, record(string().min(MIN_LENGTH$3), valueSchema));

//#endregion
//#region ../core/src/schemas/primitives.ts
const CLONE_MODES = ["blobless", "full"];
const GIT_TRANSPORTS = ["ssh", "https"];
const SAFE_SEGMENT = /^(?!\.{1,2}$)[^/\\%:]+$/u;
const HOST_SEGMENT = /^[a-z0-9][a-z0-9.-]*(?:_[1-9]\d{0,4})?$/u;
const DURATION = /^(?<amount>[1-9]\d{0,3})(?<unit>[mhd])$/u;
const MS_PER_UNIT = {
	d: 864e5,
	h: 36e5,
	m: 6e4
};
const MIN_PATH_SEGMENTS = 2;
const EMPTY_PATH_LENGTH = 0;
const MIN_PORT = 1;
const MAX_PORT = 65535;
const isValidDnsLabel = (label) => label !== "" && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(label);
const extractAndValidatePort = (portMatch) => {
	const portStr = portMatch.groups?.["port"];
	if (!portStr) return true;
	const port = Number(portStr);
	return port >= MIN_PORT && port <= MAX_PORT;
};
const isValidHostSegment = (host) => {
	const portMatch = host.match(/_(?<port>\d+)$/u);
	if (portMatch && !extractAndValidatePort(portMatch)) return false;
	let dnsName = host;
	if (portMatch) dnsName = host.slice(0, host.length - portMatch[0].length);
	return dnsName.split(".").every((label) => isValidDnsLabel(label));
};
const zRefKey = string().refine((raw) => {
	const [host, ...path] = raw.split("/");
	if (host === void 0 || path.length < MIN_PATH_SEGMENTS) return false;
	if (!HOST_SEGMENT.test(host)) return false;
	if (!isValidHostSegment(host)) return false;
	return path.every((seg) => SAFE_SEGMENT.test(seg));
}, "ref key must be host/path…/repo with safe, non-empty segments").brand();
const zDuration = string().regex(DURATION, "duration must be <n>m, <n>h, or <n>d").brand();
const durationToMs = (duration) => {
	const match = DURATION.exec(duration);
	if (match === null) throw new Error(`invalid duration: ${duration}`);
	const { amount, unit } = match.groups ?? {};
	if (!amount || !unit) throw new Error(`invalid duration: ${duration}`);
	return Number(amount) * MS_PER_UNIT[unit];
};
const zCloneMode = _enum(CLONE_MODES);
const zGitTransport = _enum(GIT_TRANSPORTS);
const zTagFormat = string().refine((raw) => raw.includes("{version}"), "tag format must contain {version}");
const zPackagePath = string().refine((raw) => {
	if (raw === ".") return true;
	const segments = raw.split("/");
	return segments.length > EMPTY_PATH_LENGTH && segments.every((seg) => SAFE_SEGMENT.test(seg) && seg !== ".");
}, "package path must be \".\" or a normalized relative path without traversal");

//#endregion
//#region ../core/src/schemas/config.ts
const MIN_LENGTH$2 = 1;
const SETTINGS_DEFAULTS = {
	clone_mode: "blobless",
	git_transport: "https",
	sync_ttl: "1h"
};
const zSettings = strictObject({
	clone_mode: zCloneMode.default(SETTINGS_DEFAULTS.clone_mode),
	git_transport: zGitTransport.default(SETTINGS_DEFAULTS.git_transport),
	sync_ttl: zDuration.default(zDuration.parse(SETTINGS_DEFAULTS.sync_ttl))
});
const removeDefaults = (shape) => Object.fromEntries(Object.entries(shape).map(([key, schema]) => [key, schema.removeDefault().optional()]));
const zRefSettingsOverride = strictObject(removeDefaults(zSettings.shape));
const zPackageEntry = strictObject({
	description: string().min(MIN_LENGTH$2),
	path: zPackagePath,
	tag_format: zTagFormat.optional()
});
const zRefEntry = strictObject({
	default_branch: string().min(MIN_LENGTH$2),
	description: string().min(MIN_LENGTH$2),
	packages: zSafePackagesRecord(zPackageEntry).optional(),
	tag_format: zTagFormat,
	url: string().min(MIN_LENGTH$2),
	...zRefSettingsOverride.shape
});
const zMeta = looseObject({
	cli_version: string().min(MIN_LENGTH$2),
	schema_version: number().int().positive()
});
const REF_KEY_ISSUE_MESSAGE = "ref key must be host/path…/repo with safe, non-empty segments";
const zRefs = withValidatedKeys((key) => zRefKey.safeParse(key).success, () => REF_KEY_ISSUE_MESSAGE, record(string(), zRefEntry));
const zConfig = strictObject({
	meta: zMeta,
	refs: zRefs.default({}),
	settings: zSettings
});

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/error.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function getLineColFromPtr(string, ptr) {
	let lines = string.slice(0, ptr).split(/\r\n|\n|\r/g);
	return [lines.length, lines.pop().length + 1];
}
function makeCodeBlock(string, line, column) {
	let lines = string.split(/\r\n|\n|\r/g);
	let codeblock = "";
	let numberLen = (Math.log10(line + 1) | 0) + 1;
	for (let i = line - 1; i <= line + 1; i++) {
		let l = lines[i - 1];
		if (!l) continue;
		codeblock += i.toString().padEnd(numberLen, " ");
		codeblock += ":  ";
		codeblock += l;
		codeblock += "\n";
		if (i === line) {
			codeblock += " ".repeat(numberLen + column + 2);
			codeblock += "^\n";
		}
	}
	return codeblock;
}
var TomlError = class extends Error {
	line;
	column;
	codeblock;
	constructor(message, options) {
		const [line, column] = getLineColFromPtr(options.toml, options.ptr);
		const codeblock = makeCodeBlock(options.toml, line, column);
		super(`Invalid TOML document: ${message}\n\n${codeblock}`, options);
		this.line = line;
		this.column = column;
		this.codeblock = codeblock;
	}
};

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/util.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function isEscaped(str, ptr) {
	let i = 0;
	while (str[ptr - ++i] === "\\");
	return --i && i % 2;
}
function indexOfNewline(str, start = 0, end = str.length) {
	let idx = str.indexOf("\n", start);
	if (str[idx - 1] === "\r") idx--;
	return idx <= end ? idx : -1;
}
function skipComment(str, ptr) {
	for (let i = ptr; i < str.length; i++) {
		let c = str[i];
		if (c === "\n") return i;
		if (c === "\r" && str[i + 1] === "\n") return i + 1;
		if (c < " " && c !== "	" || c === "") throw new TomlError("control characters are not allowed in comments", {
			toml: str,
			ptr
		});
	}
	return str.length;
}
function skipVoid(str, ptr, banNewLines, banComments) {
	let c;
	while (1) {
		while ((c = str[ptr]) === " " || c === "	" || !banNewLines && (c === "\n" || c === "\r" && str[ptr + 1] === "\n")) ptr++;
		if (banComments || c !== "#") break;
		ptr = skipComment(str, ptr);
	}
	return ptr;
}
function skipUntil(str, ptr, sep, end, banNewLines = false) {
	if (!end) {
		ptr = indexOfNewline(str, ptr);
		return ptr < 0 ? str.length : ptr;
	}
	for (let i = ptr; i < str.length; i++) {
		let c = str[i];
		if (c === "#") i = indexOfNewline(str, i);
		else if (c === sep) return i + 1;
		else if (c === end || banNewLines && (c === "\n" || c === "\r" && str[i + 1] === "\n")) return i;
	}
	throw new TomlError("cannot find end of structure", {
		toml: str,
		ptr
	});
}
function getStringEnd(str, seek) {
	let first = str[seek];
	let target = first === str[seek + 1] && str[seek + 1] === str[seek + 2] ? str.slice(seek, seek + 3) : first;
	seek += target.length - 1;
	do
		seek = str.indexOf(target, ++seek);
	while (seek > -1 && first !== "'" && isEscaped(str, seek));
	if (seek > -1) {
		seek += target.length;
		if (target.length > 1) {
			if (str[seek] === first) seek++;
			if (str[seek] === first) seek++;
		}
	}
	return seek;
}

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/date.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let DATE_TIME_RE = /^(\d{4}-\d{2}-\d{2})?[T ]?(?:(\d{2}):\d{2}(?::\d{2}(?:\.\d+)?)?)?(Z|[-+]\d{2}:\d{2})?$/i;
var TomlDate = class TomlDate extends Date {
	#hasDate = false;
	#hasTime = false;
	#offset = null;
	constructor(date) {
		let hasDate = true;
		let hasTime = true;
		let offset = "Z";
		if (typeof date === "string") {
			let match = date.match(DATE_TIME_RE);
			if (match) {
				if (!match[1]) {
					hasDate = false;
					date = `0000-01-01T${date}`;
				}
				hasTime = !!match[2];
				hasTime && date[10] === " " && (date = date.replace(" ", "T"));
				if (match[2] && +match[2] > 23) date = "";
				else {
					offset = match[3] || null;
					date = date.toUpperCase();
					if (!offset && hasTime) date += "Z";
				}
			} else date = "";
		}
		super(date);
		if (!isNaN(this.getTime())) {
			this.#hasDate = hasDate;
			this.#hasTime = hasTime;
			this.#offset = offset;
		}
	}
	isDateTime() {
		return this.#hasDate && this.#hasTime;
	}
	isLocal() {
		return !this.#hasDate || !this.#hasTime || !this.#offset;
	}
	isDate() {
		return this.#hasDate && !this.#hasTime;
	}
	isTime() {
		return this.#hasTime && !this.#hasDate;
	}
	isValid() {
		return this.#hasDate || this.#hasTime;
	}
	toISOString() {
		let iso = super.toISOString();
		if (this.isDate()) return iso.slice(0, 10);
		if (this.isTime()) return iso.slice(11, 23);
		if (this.#offset === null) return iso.slice(0, -1);
		if (this.#offset === "Z") return iso;
		let offset = +this.#offset.slice(1, 3) * 60 + +this.#offset.slice(4, 6);
		offset = this.#offset[0] === "-" ? offset : -offset;
		return (/* @__PURE__ */ new Date(this.getTime() - offset * 6e4)).toISOString().slice(0, -1) + this.#offset;
	}
	static wrapAsOffsetDateTime(jsDate, offset = "Z") {
		let date = new TomlDate(jsDate);
		date.#offset = offset;
		return date;
	}
	static wrapAsLocalDateTime(jsDate) {
		let date = new TomlDate(jsDate);
		date.#offset = null;
		return date;
	}
	static wrapAsLocalDate(jsDate) {
		let date = new TomlDate(jsDate);
		date.#hasTime = false;
		date.#offset = null;
		return date;
	}
	static wrapAsLocalTime(jsDate) {
		let date = new TomlDate(jsDate);
		date.#hasDate = false;
		date.#offset = null;
		return date;
	}
};

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/primitive.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let INT_REGEX = /^((0x[0-9a-fA-F](_?[0-9a-fA-F])*)|(([+-]|0[ob])?\d(_?\d)*))$/;
let FLOAT_REGEX = /^[+-]?\d(_?\d)*(\.\d(_?\d)*)?([eE][+-]?\d(_?\d)*)?$/;
let LEADING_ZERO = /^[+-]?0[0-9_]/;
let ESCAPE_REGEX = /^[0-9a-f]{2,8}$/i;
let ESC_MAP = {
	b: "\b",
	t: "	",
	n: "\n",
	f: "\f",
	r: "\r",
	e: "\x1B",
	"\"": "\"",
	"\\": "\\"
};
function parseString(str, ptr = 0, endPtr = str.length) {
	let isLiteral = str[ptr] === "'";
	let isMultiline = str[ptr++] === str[ptr] && str[ptr] === str[ptr + 1];
	if (isMultiline) {
		endPtr -= 2;
		if (str[ptr += 2] === "\r") ptr++;
		if (str[ptr] === "\n") ptr++;
	}
	let tmp = 0;
	let isEscape;
	let parsed = "";
	let sliceStart = ptr;
	while (ptr < endPtr - 1) {
		let c = str[ptr++];
		if (c === "\n" || c === "\r" && str[ptr] === "\n") {
			if (!isMultiline) throw new TomlError("newlines are not allowed in strings", {
				toml: str,
				ptr: ptr - 1
			});
		} else if (c < " " && c !== "	" || c === "") throw new TomlError("control characters are not allowed in strings", {
			toml: str,
			ptr: ptr - 1
		});
		if (isEscape) {
			isEscape = false;
			if (c === "x" || c === "u" || c === "U") {
				let code = str.slice(ptr, ptr += c === "x" ? 2 : c === "u" ? 4 : 8);
				if (!ESCAPE_REGEX.test(code)) throw new TomlError("invalid unicode escape", {
					toml: str,
					ptr: tmp
				});
				try {
					parsed += String.fromCodePoint(parseInt(code, 16));
				} catch {
					throw new TomlError("invalid unicode escape", {
						toml: str,
						ptr: tmp
					});
				}
			} else if (isMultiline && (c === "\n" || c === " " || c === "	" || c === "\r")) {
				ptr = skipVoid(str, ptr - 1, true);
				if (str[ptr] !== "\n" && str[ptr] !== "\r") throw new TomlError("invalid escape: only line-ending whitespace may be escaped", {
					toml: str,
					ptr: tmp
				});
				ptr = skipVoid(str, ptr);
			} else if (c in ESC_MAP) parsed += ESC_MAP[c];
			else throw new TomlError("unrecognized escape sequence", {
				toml: str,
				ptr: tmp
			});
			sliceStart = ptr;
		} else if (!isLiteral && c === "\\") {
			tmp = ptr - 1;
			isEscape = true;
			parsed += str.slice(sliceStart, tmp);
		}
	}
	return parsed + str.slice(sliceStart, endPtr - 1);
}
function parseValue(value, toml, ptr, integersAsBigInt) {
	if (value === "true") return true;
	if (value === "false") return false;
	if (value === "-inf") return -Infinity;
	if (value === "inf" || value === "+inf") return Infinity;
	if (value === "nan" || value === "+nan" || value === "-nan") return NaN;
	if (value === "-0") return integersAsBigInt ? 0n : 0;
	let isInt = INT_REGEX.test(value);
	if (isInt || FLOAT_REGEX.test(value)) {
		if (LEADING_ZERO.test(value)) throw new TomlError("leading zeroes are not allowed", {
			toml,
			ptr
		});
		value = value.replace(/_/g, "");
		let numeric = +value;
		if (isNaN(numeric)) throw new TomlError("invalid number", {
			toml,
			ptr
		});
		if (isInt) {
			if ((isInt = !Number.isSafeInteger(numeric)) && !integersAsBigInt) throw new TomlError("integer value cannot be represented losslessly", {
				toml,
				ptr
			});
			if (isInt || integersAsBigInt === true) numeric = BigInt(value);
		}
		return numeric;
	}
	const date = new TomlDate(value);
	if (!date.isValid()) throw new TomlError("invalid value", {
		toml,
		ptr
	});
	return date;
}

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/extract.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function sliceAndTrimEndOf(str, startPtr, endPtr) {
	let value = str.slice(startPtr, endPtr);
	let commentIdx = value.indexOf("#");
	if (commentIdx > -1) {
		skipComment(str, commentIdx);
		value = value.slice(0, commentIdx);
	}
	return [value.trimEnd(), commentIdx];
}
function extractValue(str, ptr, end, depth, integersAsBigInt) {
	if (depth === 0) throw new TomlError("document contains excessively nested structures. aborting.", {
		toml: str,
		ptr
	});
	let c = str[ptr];
	if (c === "[" || c === "{") {
		let [value, endPtr] = c === "[" ? parseArray(str, ptr, depth, integersAsBigInt) : parseInlineTable(str, ptr, depth, integersAsBigInt);
		if (end) {
			endPtr = skipVoid(str, endPtr);
			if (str[endPtr] === ",") endPtr++;
			else if (str[endPtr] !== end) throw new TomlError("expected comma or end of structure", {
				toml: str,
				ptr: endPtr
			});
		}
		return [value, endPtr];
	}
	let endPtr;
	if (c === "\"" || c === "'") {
		endPtr = getStringEnd(str, ptr);
		let parsed = parseString(str, ptr, endPtr);
		if (end) {
			endPtr = skipVoid(str, endPtr);
			if (str[endPtr] && str[endPtr] !== "," && str[endPtr] !== end && str[endPtr] !== "\n" && str[endPtr] !== "\r") throw new TomlError("unexpected character encountered", {
				toml: str,
				ptr: endPtr
			});
			endPtr += +(str[endPtr] === ",");
		}
		return [parsed, endPtr];
	}
	endPtr = skipUntil(str, ptr, ",", end);
	let slice = sliceAndTrimEndOf(str, ptr, endPtr - +(str[endPtr - 1] === ","));
	if (!slice[0]) throw new TomlError("incomplete key-value declaration: no value specified", {
		toml: str,
		ptr
	});
	if (end && slice[1] > -1) {
		endPtr = skipVoid(str, ptr + slice[1]);
		endPtr += +(str[endPtr] === ",");
	}
	return [parseValue(slice[0], str, ptr, integersAsBigInt), endPtr];
}

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/struct.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let KEY_PART_RE = /^[a-zA-Z0-9-_]+[ \t]*$/;
function parseKey(str, ptr, end = "=") {
	let dot = ptr - 1;
	let parsed = [];
	let endPtr = str.indexOf(end, ptr);
	if (endPtr < 0) throw new TomlError("incomplete key-value: cannot find end of key", {
		toml: str,
		ptr
	});
	do {
		let c = str[ptr = ++dot];
		if (c !== " " && c !== "	") if (c === "\"" || c === "'") {
			if (c === str[ptr + 1] && c === str[ptr + 2]) throw new TomlError("multiline strings are not allowed in keys", {
				toml: str,
				ptr
			});
			let eos = getStringEnd(str, ptr);
			if (eos < 0) throw new TomlError("unfinished string encountered", {
				toml: str,
				ptr
			});
			dot = str.indexOf(".", eos);
			let strEnd = str.slice(eos, dot < 0 || dot > endPtr ? endPtr : dot);
			let newLine = indexOfNewline(strEnd);
			if (newLine > -1) throw new TomlError("newlines are not allowed in keys", {
				toml: str,
				ptr: ptr + dot + newLine
			});
			if (strEnd.trimStart()) throw new TomlError("found extra tokens after the string part", {
				toml: str,
				ptr: eos
			});
			if (endPtr < eos) {
				endPtr = str.indexOf(end, eos);
				if (endPtr < 0) throw new TomlError("incomplete key-value: cannot find end of key", {
					toml: str,
					ptr
				});
			}
			parsed.push(parseString(str, ptr, eos));
		} else {
			dot = str.indexOf(".", ptr);
			let part = str.slice(ptr, dot < 0 || dot > endPtr ? endPtr : dot);
			if (!KEY_PART_RE.test(part)) throw new TomlError("only letter, numbers, dashes and underscores are allowed in keys", {
				toml: str,
				ptr
			});
			parsed.push(part.trimEnd());
		}
	} while (dot + 1 && dot < endPtr);
	return [parsed, skipVoid(str, endPtr + 1, true, true)];
}
function parseInlineTable(str, ptr, depth, integersAsBigInt) {
	let res = {};
	let seen = /* @__PURE__ */ new Set();
	let c;
	ptr++;
	while ((c = str[ptr++]) !== "}" && c) if (c === ",") throw new TomlError("expected value, found comma", {
		toml: str,
		ptr: ptr - 1
	});
	else if (c === "#") ptr = skipComment(str, ptr);
	else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
		let k;
		let t = res;
		let hasOwn = false;
		let [key, keyEndPtr] = parseKey(str, ptr - 1);
		for (let i = 0; i < key.length; i++) {
			if (i) t = hasOwn ? t[k] : t[k] = {};
			k = key[i];
			if ((hasOwn = Object.hasOwn(t, k)) && (typeof t[k] !== "object" || seen.has(t[k]))) throw new TomlError("trying to redefine an already defined value", {
				toml: str,
				ptr
			});
			if (!hasOwn && k === "__proto__") Object.defineProperty(t, k, {
				enumerable: true,
				configurable: true,
				writable: true
			});
		}
		if (hasOwn) throw new TomlError("trying to redefine an already defined value", {
			toml: str,
			ptr
		});
		let [value, valueEndPtr] = extractValue(str, keyEndPtr, "}", depth - 1, integersAsBigInt);
		seen.add(value);
		t[k] = value;
		ptr = valueEndPtr;
	}
	if (!c) throw new TomlError("unfinished table encountered", {
		toml: str,
		ptr
	});
	return [res, ptr];
}
function parseArray(str, ptr, depth, integersAsBigInt) {
	let res = [];
	let c;
	ptr++;
	while ((c = str[ptr++]) !== "]" && c) if (c === ",") throw new TomlError("expected value, found comma", {
		toml: str,
		ptr: ptr - 1
	});
	else if (c === "#") ptr = skipComment(str, ptr);
	else if (c !== " " && c !== "	" && c !== "\n" && c !== "\r") {
		let e = extractValue(str, ptr - 1, "]", depth - 1, integersAsBigInt);
		res.push(e[0]);
		ptr = e[1];
	}
	if (!c) throw new TomlError("unfinished array encountered", {
		toml: str,
		ptr
	});
	return [res, ptr];
}

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/parse.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
function peekTable(key, table, meta, type) {
	let t = table;
	let m = meta;
	let k;
	let hasOwn = false;
	let state;
	for (let i = 0; i < key.length; i++) {
		if (i) {
			t = hasOwn ? t[k] : t[k] = {};
			m = (state = m[k]).c;
			if (type === 0 && (state.t === 1 || state.t === 2)) return null;
			if (state.t === 2) {
				let l = t.length - 1;
				t = t[l];
				m = m[l].c;
			}
		}
		k = key[i];
		if ((hasOwn = Object.hasOwn(t, k)) && m[k]?.t === 0 && m[k]?.d) return null;
		if (!hasOwn) {
			if (k === "__proto__") {
				Object.defineProperty(t, k, {
					enumerable: true,
					configurable: true,
					writable: true
				});
				Object.defineProperty(m, k, {
					enumerable: true,
					configurable: true,
					writable: true
				});
			}
			m[k] = {
				t: i < key.length - 1 && type === 2 ? 3 : type,
				d: false,
				i: 0,
				c: {}
			};
		}
	}
	state = m[k];
	if (state.t !== type && !(type === 1 && state.t === 3)) return null;
	if (type === 2) {
		if (!state.d) {
			state.d = true;
			t[k] = [];
		}
		t[k].push(t = {});
		state.c[state.i++] = state = {
			t: 1,
			d: false,
			i: 0,
			c: {}
		};
	}
	if (state.d) return null;
	state.d = true;
	if (type === 1) t = hasOwn ? t[k] : t[k] = {};
	else if (type === 0 && hasOwn) return null;
	return [
		k,
		t,
		state.c
	];
}
function parse(toml, { maxDepth = 1e3, integersAsBigInt } = {}) {
	let res = {};
	let meta = {};
	let tbl = res;
	let m = meta;
	for (let ptr = skipVoid(toml, 0); ptr < toml.length;) {
		if (toml[ptr] === "[") {
			let isTableArray = toml[++ptr] === "[";
			let k = parseKey(toml, ptr += +isTableArray, "]");
			if (isTableArray) {
				if (toml[k[1] - 1] !== "]") throw new TomlError("expected end of table declaration", {
					toml,
					ptr: k[1] - 1
				});
				k[1]++;
			}
			let p = peekTable(k[0], res, meta, isTableArray ? 2 : 1);
			if (!p) throw new TomlError("trying to redefine an already defined table or value", {
				toml,
				ptr
			});
			m = p[2];
			tbl = p[1];
			ptr = k[1];
		} else {
			let k = parseKey(toml, ptr);
			let p = peekTable(k[0], tbl, m, 0);
			if (!p) throw new TomlError("trying to redefine an already defined table or value", {
				toml,
				ptr
			});
			let v = extractValue(toml, k[1], void 0, maxDepth, integersAsBigInt);
			p[1][p[0]] = v[0];
			ptr = v[1];
		}
		ptr = skipVoid(toml, ptr, true);
		if (toml[ptr] && toml[ptr] !== "\n" && toml[ptr] !== "\r") throw new TomlError("each key-value declaration must be followed by an end-of-line", {
			toml,
			ptr
		});
		ptr = skipVoid(toml, ptr);
	}
	return res;
}

//#endregion
//#region ../../node_modules/.pnpm/smol-toml@1.6.1/node_modules/smol-toml/dist/stringify.js
/*!
* Copyright (c) Squirrel Chat et al., All rights reserved.
* SPDX-License-Identifier: BSD-3-Clause
*
* Redistribution and use in source and binary forms, with or without
* modification, are permitted provided that the following conditions are met:
*
* 1. Redistributions of source code must retain the above copyright notice, this
*    list of conditions and the following disclaimer.
* 2. Redistributions in binary form must reproduce the above copyright notice,
*    this list of conditions and the following disclaimer in the
*    documentation and/or other materials provided with the distribution.
* 3. Neither the name of the copyright holder nor the names of its contributors
*    may be used to endorse or promote products derived from this software without
*    specific prior written permission.
*
* THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
* ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
* WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
* DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
* FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
* DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
* SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
* CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
* OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
* OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
*/
let BARE_KEY = /^[a-z0-9-_]+$/i;
function extendedTypeOf(obj) {
	let type = typeof obj;
	if (type === "object") {
		if (Array.isArray(obj)) return "array";
		if (obj instanceof Date) return "date";
	}
	return type;
}
function isArrayOfTables(obj) {
	for (let i = 0; i < obj.length; i++) if (extendedTypeOf(obj[i]) !== "object") return false;
	return obj.length != 0;
}
function formatString(s) {
	return JSON.stringify(s).replace(/\x7f/g, "\\u007f");
}
function stringifyValue(val, type, depth, numberAsFloat) {
	if (depth === 0) throw new Error("Could not stringify the object: maximum object depth exceeded");
	if (type === "number") {
		if (isNaN(val)) return "nan";
		if (val === Infinity) return "inf";
		if (val === -Infinity) return "-inf";
		if (numberAsFloat && Number.isInteger(val)) return val.toFixed(1);
		return val.toString();
	}
	if (type === "bigint" || type === "boolean") return val.toString();
	if (type === "string") return formatString(val);
	if (type === "date") {
		if (isNaN(val.getTime())) throw new TypeError("cannot serialize invalid date");
		return val.toISOString();
	}
	if (type === "object") return stringifyInlineTable(val, depth, numberAsFloat);
	if (type === "array") return stringifyArray(val, depth, numberAsFloat);
}
function stringifyInlineTable(obj, depth, numberAsFloat) {
	let keys = Object.keys(obj);
	if (keys.length === 0) return "{}";
	let res = "{ ";
	for (let i = 0; i < keys.length; i++) {
		let k = keys[i];
		if (i) res += ", ";
		res += BARE_KEY.test(k) ? k : formatString(k);
		res += " = ";
		res += stringifyValue(obj[k], extendedTypeOf(obj[k]), depth - 1, numberAsFloat);
	}
	return res + " }";
}
function stringifyArray(array, depth, numberAsFloat) {
	if (array.length === 0) return "[]";
	let res = "[ ";
	for (let i = 0; i < array.length; i++) {
		if (i) res += ", ";
		if (array[i] === null || array[i] === void 0) throw new TypeError("arrays cannot contain null or undefined values");
		res += stringifyValue(array[i], extendedTypeOf(array[i]), depth - 1, numberAsFloat);
	}
	return res + " ]";
}
function stringifyArrayTable(array, key, depth, numberAsFloat) {
	if (depth === 0) throw new Error("Could not stringify the object: maximum object depth exceeded");
	let res = "";
	for (let i = 0; i < array.length; i++) {
		res += `${res && "\n"}[[${key}]]\n`;
		res += stringifyTable(0, array[i], key, depth, numberAsFloat);
	}
	return res;
}
function stringifyTable(tableKey, obj, prefix, depth, numberAsFloat) {
	if (depth === 0) throw new Error("Could not stringify the object: maximum object depth exceeded");
	let preamble = "";
	let tables = "";
	let keys = Object.keys(obj);
	for (let i = 0; i < keys.length; i++) {
		let k = keys[i];
		if (obj[k] !== null && obj[k] !== void 0) {
			let type = extendedTypeOf(obj[k]);
			if (type === "symbol" || type === "function") throw new TypeError(`cannot serialize values of type '${type}'`);
			let key = BARE_KEY.test(k) ? k : formatString(k);
			if (type === "array" && isArrayOfTables(obj[k])) tables += (tables && "\n") + stringifyArrayTable(obj[k], prefix ? `${prefix}.${key}` : key, depth - 1, numberAsFloat);
			else if (type === "object") {
				let tblKey = prefix ? `${prefix}.${key}` : key;
				tables += (tables && "\n") + stringifyTable(tblKey, obj[k], tblKey, depth - 1, numberAsFloat);
			} else {
				preamble += key;
				preamble += " = ";
				preamble += stringifyValue(obj[k], type, depth, numberAsFloat);
				preamble += "\n";
			}
		}
	}
	if (tableKey && (preamble || !tables)) preamble = preamble ? `[${tableKey}]\n${preamble}` : `[${tableKey}]`;
	return preamble && tables ? `${preamble}\n${tables}` : preamble || tables;
}
function stringify(obj, { maxDepth = 1e3, numbersAsFloat = false } = {}) {
	if (extendedTypeOf(obj) !== "object") throw new TypeError("stringify can only be called with an object");
	let str = stringifyTable(0, obj, "", maxDepth, numbersAsFloat);
	if (str[str.length - 1] !== "\n") return str + "\n";
	return str;
}

//#endregion
//#region ../core/src/fs-atomic.ts
const isEnoent = (err) => typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
const writeFileAtomic = async (path, contents) => {
	await mkdir(dirname(path), { recursive: true });
	const tmpPath = `${path}.tmp-${randomUUID()}`;
	await writeFile(tmpPath, contents, "utf8");
	await rename(tmpPath, path);
};

//#endregion
//#region ../core/src/home.ts
const NO_MISSING_SEGMENTS = 0;
const PARENT_DIR_SEGMENT$1 = "..";
const resolveHome = (env) => {
	const root = resolve(env["REFS_HOME"] ?? join(homedir(), ".kaisers-io", "refs"));
	return {
		configPath: join(root, "config.toml"),
		hooksDir: join(root, "hooks"),
		locksDir: join(root, "locks"),
		root,
		sourcesDir: join(root, "sources"),
		statePath: join(root, "state.json")
	};
};
const checkoutPath = (home, key) => join(home.sourcesDir, ...key.split("/"));
const configBackupPath = (home) => `${home.configPath}.bak`;
const findExistingAncestor = (target) => {
	const missing = [];
	let current = target;
	while (!existsSync(current)) {
		const parent = dirname(current);
		if (parent === current) break;
		missing.unshift(basename(current));
		current = parent;
	}
	return {
		ancestor: current,
		missing
	};
};
const realpathDeepestExisting = (target) => {
	const { ancestor, missing } = findExistingAncestor(target);
	const resolved = realpathSync(ancestor);
	if (missing.length === NO_MISSING_SEGMENTS) return resolved;
	return join(resolved, ...missing);
};
/**
* Guarantee: resolves symlinks in the EXISTING path components of both `home.sourcesDir` and
* `absolutePath` (via realpathDeepestExisting) before comparing. For any non-existing suffix of
* `absolutePath` the check is point-in-time only — a concurrent writer could plant a symlink in
* that suffix between this check and a later destructive use, so this guard does not fully close
* TOCTOU races (that would require openat-style traversal, out of scope for a local single-user
* tool). Destructive callers (e.g. `refs remove`) MUST call this guard against an existing target
* immediately before the destructive operation, not earlier, to minimise the race window.
* `rel === ''` (target is sourcesDir itself) is rejected too.
*/
const assertInsideSources = (home, absolutePath) => {
	const rel = relative(realpathDeepestExisting(home.sourcesDir), realpathDeepestExisting(absolutePath));
	const isParentOrAbove = rel === PARENT_DIR_SEGMENT$1 || rel.startsWith(PARENT_DIR_SEGMENT$1 + sep);
	if (!(rel !== "" && !isParentOrAbove && !isAbsolute(rel))) throw validationError(`path escapes sources directory (containment violation): ${absolutePath}`);
};

//#endregion
//#region ../core/src/config-io.ts
const isPlainObject$2 = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const asRecordOr = (value, fallback) => {
	if (isPlainObject$2(value)) return value;
	return fallback;
};
const DEFAULT_CONFIG_TOML = `# refs configuration
#
# Every global setting under [settings] can also be set per-ref: add the same
# key directly inside a [refs."host/owner/repo"] table to override it just for
# that ref — every global setting is per-ref overridable.

[meta]
schema_version = ${1}
cli_version = "{{CLI_VERSION}}"

[settings]
# Clone strategy for newly added refs. One of "blobless" (partial clone, default) or "full".
clone_mode = "blobless"
# Transport for npm:-resolved adds: their clone url is rewritten to this before cloning.
# One of "https" (default) or "ssh" (for private-package setups with forge ssh keys).
# Explicitly-typed git urls are always used verbatim.
git_transport = "https"
# How long a ref's fetched state is considered fresh before refs re-fetches it.
# Format: <n>m, <n>h, or <n>d (e.g. "30m", "1h", "1d"). Default: "1h".
sync_ttl = "1h"

[refs]
# Add refs here, one table per ref, keyed by "host/owner/repo". Example:
#
# [refs."github.com/owner/repo"]
# description = "Short description of the repo."
# url = "https://github.com/owner/repo"
# default_branch = "main"
# tag_format = "v{version}"
# # Per-ref overrides of [settings] go in the same table, e.g.:
# # clone_mode = "full"
`;
const readConfigText = async (home) => {
	try {
		return await readFile(home.configPath, "utf8");
	} catch (error) {
		if (isEnoent(error)) throw notFoundError("no config found — run: refs init");
		throw error;
	}
};
const parseConfigToml = (text, path) => {
	try {
		return parse(text);
	} catch (error) {
		if (error instanceof TomlError) throw validationError(`invalid TOML in ${path}: ${error.message}`);
		throw error;
	}
};
const MIN_SCHEMA_VERSION = 1;
const isValidSchemaVersion = (value) => typeof value === "number" && Number.isInteger(value) && value >= MIN_SCHEMA_VERSION;
const extractSchemaVersion = (raw) => {
	const { meta } = raw;
	if (!isPlainObject$2(meta)) return;
	const version = meta["schema_version"];
	if (isValidSchemaVersion(version)) return version;
};
const assertSupportedSchemaVersion = (raw, path) => {
	const rawVersion = extractSchemaVersion(raw);
	if (rawVersion === void 0) throw validationError(`config schema version is missing or invalid in ${path} — run: refs migrate`);
	if (rawVersion > 1) throw validationError(`config schema ${rawVersion} is newer than this CLI supports — upgrade refs`);
	if (rawVersion < 1) throw validationError(`config schema ${rawVersion} is older than expected ${1} — run: refs migrate`);
};
const readConfig = async (home) => {
	const text = await readConfigText(home);
	const raw = parseConfigToml(text, home.configPath);
	assertSupportedSchemaVersion(raw, home.configPath);
	const result = zConfig.safeParse(raw);
	if (!result.success) throw validationError(prettifyError(result.error));
	return result.data;
};
const writeConfig = async (home, config) => {
	const result = zConfig.safeParse(config);
	if (!result.success) throw validationError(prettifyError(result.error));
	await writeFileAtomic(home.configPath, stringify(result.data));
};
const pathExists$1 = async (path) => {
	try {
		await stat(path);
		return true;
	} catch (error) {
		if (isEnoent(error)) return false;
		throw error;
	}
};
const seedConfig = async (home, cliVersion) => {
	if (await pathExists$1(home.configPath)) return "noop";
	await writeFileAtomic(home.configPath, DEFAULT_CONFIG_TOML.replaceAll("{{CLI_VERSION}}", cliVersion));
	return "seeded";
};
const deepMergeFillMissing = (target, skeleton) => {
	const merged = { ...target };
	for (const [key, skeletonValue] of Object.entries(skeleton)) {
		const currentValue = merged[key];
		if (currentValue === void 0) merged[key] = skeletonValue;
		else if (isPlainObject$2(currentValue) && isPlainObject$2(skeletonValue)) merged[key] = deepMergeFillMissing(currentValue, skeletonValue);
	}
	return merged;
};
const MIGRATION_SKELETON = {
	meta: {},
	refs: {},
	settings: {}
};
const readConfigTextOrAbsent = async (home) => {
	try {
		return await readConfigText(home);
	} catch (error) {
		if (error instanceof RefsError && error.code === "not_found") return;
		throw error;
	}
};
const assertNotNewerForMigration = (rawVersion) => {
	if (rawVersion !== void 0 && rawVersion > 1) throw validationError(`config schema ${rawVersion} is newer than this CLI supports — upgrade refs`);
};
const stampCliVersionIfChanged = async (home, raw, cliVersion) => {
	const currentMeta = asRecordOr(raw["meta"], {});
	if (currentMeta["cli_version"] === cliVersion) return;
	const stamped = {
		...raw,
		meta: {
			...currentMeta,
			cli_version: cliVersion
		}
	};
	await writeFileAtomic(home.configPath, stringify(stamped));
};
const migrateOlderConfig = async (home, raw, cliVersion) => {
	await copyFile(home.configPath, configBackupPath(home));
	const filled = deepMergeFillMissing(raw, MIGRATION_SKELETON);
	const filledMeta = asRecordOr(filled["meta"], {});
	const migrated = {
		...filled,
		meta: {
			...filledMeta,
			cli_version: cliVersion,
			schema_version: 1
		}
	};
	const result = zConfig.safeParse(migrated);
	if (!result.success) throw validationError(`config in ${home.configPath} is malformed beyond automatic migration (backup preserved at ${configBackupPath(home)}): ${prettifyError(result.error)}`);
	await writeFileAtomic(home.configPath, stringify(migrated));
};
const seedAndReport = async (home, cliVersion) => {
	await seedConfig(home, cliVersion);
	return "seeded";
};
const migrateExistingConfig = async (home, text, cliVersion) => {
	const raw = parseConfigToml(text, home.configPath);
	const rawVersion = extractSchemaVersion(raw);
	assertNotNewerForMigration(rawVersion);
	if (rawVersion === 1) {
		await stampCliVersionIfChanged(home, raw, cliVersion);
		return "noop";
	}
	await migrateOlderConfig(home, raw, cliVersion);
	return "migrated";
};
const migrateConfig = async (home, cliVersion) => {
	const text = await readConfigTextOrAbsent(home);
	if (text === void 0) return seedAndReport(home, cliVersion);
	return migrateExistingConfig(home, text, cliVersion);
};

//#endregion
//#region ../core/src/git/sync-result.ts
const RESTORED_WARNING = "checkout had local changes (managed checkouts are read-only) — discarded and restored to the remote state";
const NO_WARNINGS$6 = 0;
const EXCERPT_MAX_LENGTH = 200;
const FIRST_LINE_INDEX = 0;
/** Best-effort one-line summary of a failed command's output, for a `SyncResult` warning. */
const excerpt = (result) => {
	const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
	const firstLine = detail.split("\n")[FIRST_LINE_INDEX] ?? detail;
	if (firstLine.length <= EXCERPT_MAX_LENGTH) return firstLine;
	return `${firstLine.slice(FIRST_LINE_INDEX, EXCERPT_MAX_LENGTH)}…`;
};
const computeStatus = (shas, dirty) => {
	if (dirty) return "restored";
	if (shas.oldSha === shas.newSha) return "fresh";
	return "updated";
};
const computeWarning = (dirty, setHeadWarning) => {
	const warnings = [];
	if (dirty) warnings.push(RESTORED_WARNING);
	if (setHeadWarning !== void 0) warnings.push(setHeadWarning);
	if (warnings.length === NO_WARNINGS$6) return;
	return warnings.join(" | ");
};
const buildSyncResult = (opts) => {
	const { branchRenamedTo, dirty, setHeadWarning, shas } = opts;
	const result = {
		...shas,
		status: computeStatus(shas, dirty)
	};
	if (branchRenamedTo !== void 0) result.branchRenamedTo = branchRenamedTo;
	const warning = computeWarning(dirty, setHeadWarning);
	if (warning !== void 0) result.warning = warning;
	return result;
};
const toBuildSyncResultOpts = (syncBranch, dirty, shas) => {
	const built = {
		dirty,
		shas
	};
	if (syncBranch.branchRenamedTo !== void 0) built.branchRenamedTo = syncBranch.branchRenamedTo;
	if (syncBranch.warning !== void 0) built.setHeadWarning = syncBranch.warning;
	return built;
};

//#endregion
//#region ../core/src/git/managed-checkout.ts
const SUCCESS_EXIT_CODE$5 = 0;
/** Whether `dir` is (the top level of) a git checkout — a plain fs check, no `Runner` involved. */
const isGitCheckout = (dir) => existsSync(join(dir, ".git"));
const notManagedMessage = (dir) => `refusing to sync ${dir}: not a refs-managed checkout`;
const assertManagedCheckout = async (runner, dir) => {
	if (!isGitCheckout(dir)) throw validationError(notManagedMessage(dir));
	const hooksPath = await runner.run("git", [
		"config",
		"--local",
		"--get",
		"core.hooksPath"
	], { cwd: dir });
	if (hooksPath.exitCode !== SUCCESS_EXIT_CODE$5 || hooksPath.stdout.trim() === "") throw validationError(notManagedMessage(dir));
};

//#endregion
//#region ../core/src/git/repo.ts
const DEFAULT_TAG_LIMIT = 20;
const TAG_LIST_START = 0;
const SUCCESS_EXIT_CODE$4 = 0;
const HOOK_MODE = 493;
const FILTER_NOT_HONOURED_PATTERN = /filtering not recognized/iu;
const cwdOpt$1 = (cwd) => {
	if (cwd === void 0) return {};
	return { cwd };
};
const gitSpec = (action, args, cwd) => ({
	action,
	args,
	cmd: "git",
	...cwdOpt$1(cwd)
});
const runOrThrow = async (runner, spec) => {
	const result = await runner.run(spec.cmd, spec.args, cwdOpt$1(spec.cwd));
	if (result.exitCode === SUCCESS_EXIT_CODE$4) return result;
	const detail = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
	throw validationError(`${spec.action} failed: ${detail}`);
};
const cloneRepo = async (runner, opts) => {
	const args = ["clone", "-q"];
	if (opts.mode === "blobless") args.push("--filter=blob:none");
	args.push(opts.cloneUrl, opts.dest);
	const cloneResult = await runOrThrow(runner, gitSpec("git clone", args));
	await runOrThrow(runner, gitSpec("git config core.hooksPath", [
		"config",
		"core.hooksPath",
		opts.hooksDir
	], opts.dest));
	if (!(opts.mode === "blobless" && FILTER_NOT_HONOURED_PATTERN.test(cloneResult.stderr))) return { effectiveMode: opts.mode };
	return {
		effectiveMode: "full",
		warning: "server did not honour the partial-clone filter (blob:none); fell back to a full clone"
	};
};
const tryReadOriginHead = async (runner, dir) => {
	const result = await runner.run("git", [
		"symbolic-ref",
		"--short",
		"refs/remotes/origin/HEAD"
	], { cwd: dir });
	if (result.exitCode !== SUCCESS_EXIT_CODE$4) return;
	const branch = result.stdout.trim();
	if (branch.startsWith("origin/")) return branch.slice(7);
	return branch;
};
const detectDefaultBranch = async (runner, dir) => {
	const direct = await tryReadOriginHead(runner, dir);
	if (direct !== void 0) return direct;
	await runner.run("git", [
		"remote",
		"set-head",
		"origin",
		"--auto"
	], { cwd: dir });
	const retried = await tryReadOriginHead(runner, dir);
	if (retried !== void 0) return retried;
	throw validationError(`could not detect the default branch for checkout: ${dir}`);
};
const currentSha = async (runner, dir) => {
	return (await runOrThrow(runner, gitSpec("git rev-parse HEAD", ["rev-parse", "HEAD"], dir))).stdout.trim();
};
const isDirty = async (runner, dir) => {
	return (await runOrThrow(runner, gitSpec("git status --porcelain", ["status", "--porcelain"], dir))).stdout.trim() !== "";
};
const resolveSyncBranch = async (runner, opts) => {
	await runOrThrow(runner, gitSpec("git fetch", [
		"fetch",
		"--prune",
		"--tags",
		"origin"
	], opts.dir));
	const setHeadResult = await runner.run("git", [
		"remote",
		"set-head",
		"origin",
		"--auto"
	], { cwd: opts.dir });
	const branch = await detectDefaultBranch(runner, opts.dir);
	const result = { branch };
	if (branch !== opts.defaultBranch) result.branchRenamedTo = branch;
	if (setHeadResult.exitCode !== SUCCESS_EXIT_CODE$4) result.warning = `could not refresh origin/HEAD: ${excerpt(setHeadResult)}`;
	return result;
};
const dirtyCleanupSteps = (dir) => [gitSpec("git reset --hard HEAD (pre-checkout)", [
	"reset",
	"--hard",
	"HEAD"
], dir), gitSpec("git clean -fd", ["clean", "-fd"], dir)];
const hardResetToBranch = async (runner, opts) => {
	const { branch, dir, dirty } = opts;
	const steps = [];
	if (dirty) steps.push(...dirtyCleanupSteps(dir));
	steps.push(gitSpec("git checkout -B", [
		"checkout",
		"-B",
		branch,
		`origin/${branch}`
	], dir), gitSpec("git reset --hard", [
		"reset",
		"--hard",
		`origin/${branch}`
	], dir));
	for (const step of steps) await runOrThrow(runner, step);
};
/**
* Implements the §4 sync sequence under the caller's per-ref lock: guard against an unmanaged
* checkout, fetch, refresh `origin/HEAD` and re-detect the default branch (rename →
* `branchRenamedTo`), snapshot dirtiness, then hard-reset to `origin/<branch>` — see
* `buildSyncResult` (sync-result.ts) for the status/warning semantics.
*/
const syncRef = async (runner, opts) => {
	await assertManagedCheckout(runner, opts.dir);
	const oldSha = await currentSha(runner, opts.dir);
	const syncBranch = await resolveSyncBranch(runner, opts);
	const dirty = await isDirty(runner, opts.dir);
	await hardResetToBranch(runner, {
		branch: syncBranch.branch,
		dir: opts.dir,
		dirty
	});
	return buildSyncResult(toBuildSyncResultOpts(syncBranch, dirty, {
		newSha: await currentSha(runner, opts.dir),
		oldSha
	}));
};
/** First `limit` tags, newest-first (`git tag --sort=-version:refname`), or `[]` if none. */
const listTags = async (runner, dir, limit = DEFAULT_TAG_LIMIT) => {
	return (await runOrThrow(runner, gitSpec("git tag", ["tag", "--sort=-version:refname"], dir))).stdout.split("\n").map((line) => line.trim()).filter((line) => line !== "").slice(TAG_LIST_START, limit);
};
const SHOW_REF_SEPARATOR = "--";
/** Whether `tag` resolves to a real annotated/lightweight tag ref in `dir` — a literal ref-name
* check, not git revision-syntax resolution. */
const tagExists = async (runner, dir, tag) => {
	return (await runner.run("git", [
		"show-ref",
		"--verify",
		SHOW_REF_SEPARATOR,
		`refs/tags/${tag}`
	], { cwd: dir })).exitCode === SUCCESS_EXIT_CODE$4;
};
const GUARD_HOOK_SCRIPT = [
	"#!/bin/sh",
	"echo \"refs: this checkout is a managed read-only reference — commits are blocked\" >&2",
	"exit 1",
	""
].join("\n");
const installHooksGuard = async (home) => {
	await Promise.all(["pre-commit", "pre-push"].map(async (name) => {
		const path = join(home.hooksDir, name);
		await writeFileAtomic(path, GUARD_HOOK_SCRIPT);
		await chmod(path, HOOK_MODE);
	}));
};

//#endregion
//#region ../core/src/git/tags.ts
const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?/u;
const BARE_VERSION = /\d+\.\d+\.\d+/gu;
const MAX_UNAMBIGUOUS_VERSION_COUNT = 1;
const FIRST_INDEX = 0;
const INITIAL_COUNT = 1;
const INCREMENT = 1;
/** Validates that a derived format is acceptable. */
const isValidFormat = (format) => {
	return zTagFormat.safeParse(format).success;
};
/** True if the tag embeds more than one bare major.minor.patch triple, making it ambiguous. */
const hasMultipleEmbeddedVersions = (tag) => {
	const bareMatches = tag.match(BARE_VERSION);
	return bareMatches !== null && bareMatches.length > MAX_UNAMBIGUOUS_VERSION_COUNT;
};
/** Attempts to derive a tag format from a single tag by replacing semver with {version}. */
const tryDeriveFormat = (tag) => {
	const match = SEMVER.exec(tag);
	if (!match) return;
	if (hasMultipleEmbeddedVersions(tag)) return;
	const [semverMatch] = match;
	const format = tag.replace(semverMatch, "{version}");
	if (!isValidFormat(format)) return;
	return format;
};
/** Increments format count in the frequency map. */
const incrementFormatCount = (counts, format, index) => {
	const existing = counts.get(format);
	if (existing === void 0) counts.set(format, {
		count: INITIAL_COUNT,
		index
	});
	else existing.count += INCREMENT;
};
/** Builds a frequency map of formats from tags. */
const buildFormatCounts = (tags) => {
	const counts = /* @__PURE__ */ new Map();
	for (let idx = 0; idx < tags.length; idx += INCREMENT) {
		const tag = tags[idx];
		if (tag === void 0) continue;
		const format = tryDeriveFormat(tag);
		if (!format) continue;
		incrementFormatCount(counts, format, idx);
	}
	return counts;
};
/** Compares two format candidates to determine the best one. */
const isBetter = (newCandidate, bestCandidate) => newCandidate.count > bestCandidate.count || newCandidate.count === bestCandidate.count && newCandidate.index < bestCandidate.index;
/** Finds the most frequent format; on a tie, the earliest index (most recent) wins. */
const findBestFormat = (formatCounts) => {
	const entries = [...formatCounts.entries()];
	if (entries.length === FIRST_INDEX) return null;
	const firstEntry = entries[FIRST_INDEX];
	if (!firstEntry) return null;
	const [best, firstCandidate] = firstEntry;
	return entries.slice(INCREMENT).reduce(({ format: fmt, data: current }, [candidate, data]) => {
		if (isBetter(data, current)) return {
			data,
			format: candidate
		};
		return {
			data: current,
			format: fmt
		};
	}, {
		data: firstCandidate,
		format: best
	}).format;
};
/**
* Detects the dominant tag format from a list of recent tags (newest-first from git tag --sort=-version:refname).
* Replaces the first semver substring in each tag with {version}; tags without semver are ignored.
* Groups identical formats and returns the most frequent; on a tie, the most recent tag wins.
* Returns null if no valid formats are found.
*/
const detectTagFormat = (tags) => {
	const formatCounts = buildFormatCounts(tags);
	return findBestFormat(formatCounts);
};
/**
* Renders a tag by replacing {version} with the provided version string.
* Uses a replacer function to avoid $ pattern interpretation in String.replace,
* and replaceAll to handle multiple {version} placeholders.
*/
const renderTag = (format, version) => format.replaceAll("{version}", () => version);
/**
* Resolves a tag by rendering it with the provided version and verifying it exists.
* Throws notFoundError if the tag does not exist.
*/
const resolveTag = async (runner, dir, format, version) => {
	const tag = renderTag(format, version);
	if (!await tagExists(runner, dir, tag)) throw notFoundError(`tag '${tag}' not found in ${dir} — check the version or tag_format`);
	return tag;
};

//#endregion
//#region ../core/src/git-url.ts
const SCP_URL = /^git@(?<host>[^:/\s]+):(?<path>[^\s]+)$/u;
const GIT_PLUS_PREFIX = /^git\+/u;
const DEFAULT_PORTS = {
	"https:": "443",
	"ssh:": "22"
};
const MIN_FILE_SEGMENTS = 2;
const LAST_SEGMENT_OFFSET = -1;
const SECOND_LAST_SEGMENT_OFFSET = -2;
const stripGitSuffix = (path) => path.replace(/\.git$/u, "");
const hasDotSegment = (raw) => raw.split("/").some((segment) => segment === "." || segment === "..");
const hasBackslash = (raw) => raw.includes("\\");
const hasPercentEncoding = (raw) => raw.includes("%");
const parseAsRefKey = (candidate) => {
	const parsed = zRefKey.safeParse(candidate);
	if (!parsed.success) throw validationError(`not a supported git url: derived key '${candidate}' is invalid`);
	return parsed.data;
};
const hostSegmentFor = ({ host, port, protocol }) => {
	const defaultPort = DEFAULT_PORTS[protocol];
	if (port === "" || port === defaultPort) return host.toLowerCase();
	return `${host.toLowerCase()}_${port}`;
};
const buildKey = (input) => {
	const cleanPath = stripGitSuffix(input.path.replace(/^\/+/u, "").replace(/\/+$/u, ""));
	return parseAsRefKey(`${hostSegmentFor(input)}/${cleanPath}`);
};
const buildFileKey = (pathname) => {
	const segments = decodeURIComponent(pathname).split("/").filter((segment) => segment !== "");
	if (segments.length < MIN_FILE_SEGMENTS) throw validationError(`not a supported git url: file url path must have at least ${MIN_FILE_SEGMENTS} segments`);
	const secondLast = segments.at(SECOND_LAST_SEGMENT_OFFSET) ?? "";
	const last = segments.at(LAST_SEGMENT_OFFSET) ?? "";
	return parseAsRefKey(`local/${secondLast}/${last}`);
};
const parseUrl = (cloneUrl, original) => {
	try {
		return new URL(cloneUrl);
	} catch {
		throw validationError(`not a supported git url: ${original}`);
	}
};
const assertNoCredentials = (url) => {
	if (url.password !== "") throw validationError("not a supported git url: credentials embedded in url");
	if (url.protocol === "https:" && url.username !== "") throw validationError("not a supported git url: credentials embedded in https url");
};
const resolveKeyFromUrl = (url, allowFileUrls) => {
	if (url.protocol === "file:") {
		if (!allowFileUrls) throw validationError(`not a supported git url: unsupported protocol ${url.protocol}`);
		return buildFileKey(url.pathname);
	}
	if (url.protocol !== "https:" && url.protocol !== "ssh:") throw validationError(`not a supported git url: unsupported protocol ${url.protocol}`);
	assertNoCredentials(url);
	return buildKey({
		host: url.hostname,
		path: url.pathname,
		port: url.port,
		protocol: url.protocol
	});
};
const assertSafeScpPath = (scpPath, input) => {
	if (hasPercentEncoding(scpPath)) throw validationError(`not a supported git url: percent-encoding not supported in ${input}`);
	if (scpPath.includes(":")) throw validationError(`not a supported git url: ambiguous ':' in scp-style path ${input}; use the ssh:// url form instead`);
	if (scpPath.startsWith("/") || scpPath.startsWith("~")) throw validationError(`not a supported git url: ambiguous absolute/home-relative scp path in ${input}; use the ssh:// url form instead`);
};
const resolveScpKey = (scp, input) => {
	const scpPath = scp.groups?.["path"] ?? "";
	assertSafeScpPath(scpPath, input);
	return buildKey({
		host: scp.groups?.["host"] ?? "",
		path: scpPath,
		port: "",
		protocol: "ssh:"
	});
};
const assertNoBackslash = (cloneUrl, input) => {
	if (hasBackslash(cloneUrl)) throw validationError(`not a supported git url: backslash not allowed in ${input}`);
};
const assertNoDotSegment = (cloneUrl, input) => {
	if (hasDotSegment(cloneUrl)) throw validationError(`not a supported git url: path traversal segment in ${input}`);
};
const assertNoPercentEncodingUnlessFile = (url, cloneUrl, input) => {
	if (url.protocol !== "file:" && hasPercentEncoding(cloneUrl)) throw validationError(`not a supported git url: percent-encoding not supported in ${input}`);
};
const canonicalizeGitUrl = (input, opts) => {
	const allowFileUrls = opts?.allowFileUrls ?? false;
	const cloneUrl = input.replace(GIT_PLUS_PREFIX, "");
	assertNoBackslash(cloneUrl, input);
	assertNoDotSegment(cloneUrl, input);
	const scp = SCP_URL.exec(cloneUrl);
	if (scp?.groups !== void 0) return {
		cloneUrl,
		key: resolveScpKey(scp, input)
	};
	const url = parseUrl(cloneUrl, input);
	assertNoPercentEncodingUnlessFile(url, cloneUrl, input);
	return {
		cloneUrl,
		key: resolveKeyFromUrl(url, allowFileUrls)
	};
};
const FILE_PROTOCOL_PREFIX = "file:";
const GIT_SUFFIX = ".git";
const trimPathSlashes = (path) => path.replace(/^\/+/u, "").replace(/\/+$/u, "");
const ensureGitSuffix = (path) => {
	if (path.endsWith(GIT_SUFFIX)) return path;
	return `${path}${GIT_SUFFIX}`;
};
const httpsFormOf = (host, path) => `https://${host.toLowerCase()}/${trimPathSlashes(path)}`;
const scpFormOf = (host, path) => `git@${host.toLowerCase()}:${ensureGitSuffix(trimPathSlashes(path))}`;
const transportOfProtocol = (protocol, input) => {
	if (protocol === "https:") return "https";
	if (protocol === "ssh:") return "ssh";
	throw validationError(`not a supported git url: unsupported protocol ${protocol} in ${input}`);
};
const rejectNonDefaultPort = (url, transport, input) => {
	const defaultPort = DEFAULT_PORTS[url.protocol];
	if (url.port !== "" && url.port !== defaultPort) throw validationError(`cannot apply git_transport=${transport} to ${input}: its non-default port ${url.port} cannot be expressed in the ${transport} url form — add the repo with an explicit url instead`);
};
const targetFormOf = (url, transport) => {
	if (transport === "https") return httpsFormOf(url.hostname, url.pathname);
	return scpFormOf(url.hostname, url.pathname);
};
const assertKeyInvariant = (input, transformed, originalKey) => {
	const transformedKey = canonicalizeGitUrl(transformed).key;
	if (transformedKey !== originalKey) throw validationError(`git_transport transform changed repo identity: '${input}' → '${transformed}' (key '${originalKey}' → '${transformedKey}')`);
	return transformed;
};
const transformFromScp = (scp, ctx) => {
	if (ctx.transport === "ssh") return ctx.cloneUrl;
	const host = scp.groups?.["host"] ?? "";
	const path = scp.groups?.["path"] ?? "";
	return assertKeyInvariant(ctx.cloneUrl, httpsFormOf(host, path), ctx.originalKey);
};
const transformFromUrlForm = (ctx) => {
	const url = parseUrl(ctx.cloneUrl, ctx.cloneUrl);
	if (transportOfProtocol(url.protocol, ctx.cloneUrl) === ctx.transport) return ctx.cloneUrl;
	rejectNonDefaultPort(url, ctx.transport, ctx.cloneUrl);
	return assertKeyInvariant(ctx.cloneUrl, targetFormOf(url, ctx.transport), ctx.originalKey);
};
/** Rewrites `cloneUrl` to the requested `transport` (spec §3 transport rule): https ↔ the scp
* ssh form `git@host:path.git`. Only `npm:`-resolved urls are ever passed here — a url the user
* typed explicitly is used verbatim by the add flow and never reaches this function. A url
* already on the requested transport is returned byte-for-byte unchanged (including one with a
* non-default port); `file:` urls — the test-only escape hatch, which npm resolution can never
* produce — are exempt. The canonical key is transport-invariant: every rewrite is round-tripped
* through `canonicalizeGitUrl` and a key change throws instead of returning. */
const applyGitTransport = (cloneUrl, transport) => {
	if (cloneUrl.startsWith(FILE_PROTOCOL_PREFIX)) return cloneUrl;
	const context = {
		cloneUrl,
		originalKey: canonicalizeGitUrl(cloneUrl).key,
		transport
	};
	const scp = SCP_URL.exec(cloneUrl);
	if (scp?.groups !== void 0) return transformFromScp(scp, context);
	return transformFromUrlForm(context);
};

//#endregion
//#region ../core/src/lock-meta.ts
const NO_SIGNAL = 0;
const META_FILENAME = "meta.json";
const errnoCode = (err) => {
	if (typeof err === "object" && err !== null && "code" in err) {
		const { code } = err;
		if (typeof code === "string") return code;
	}
};
const isPidAlive = (pid) => {
	try {
		process.kill(pid, NO_SIGNAL);
		return true;
	} catch (error) {
		return errnoCode(error) !== "ESRCH";
	}
};
const tryParseJson$1 = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
};
const readTextOrUndefined = async (path) => {
	try {
		return await readFile(path, "utf8");
	} catch {
		return;
	}
};
const parseAcquiredAtMs = (value) => {
	if (typeof value !== "string") return;
	const parsedMs = Date.parse(value);
	if (Number.isNaN(parsedMs)) return;
	return parsedMs;
};
const parseLockMeta = (raw) => {
	if (typeof raw !== "object" || raw === null) return;
	const record = raw;
	const { pid } = record;
	const acquiredAtMs = parseAcquiredAtMs(record["acquired_at"]);
	if (typeof pid !== "number" || acquiredAtMs === void 0) return;
	return {
		acquiredAtMs,
		pid
	};
};
const readLockMeta = async (lockPath) => {
	const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
	if (text === void 0) return;
	return parseLockMeta(tryParseJson$1(text));
};
const extractToken = (raw) => {
	if (typeof raw !== "object" || raw === null) return;
	const { token } = raw;
	if (typeof token !== "string") return;
	return token;
};
const readLockToken = async (lockPath) => {
	const text = await readTextOrUndefined(join(lockPath, META_FILENAME));
	if (text === void 0) return;
	return extractToken(tryParseJson$1(text));
};
const dirMtimeMs = async (path) => {
	try {
		return (await stat(path)).mtimeMs;
	} catch {
		return;
	}
};
const writeMetaAtomic = async (lockPath, contents) => {
	const path = join(lockPath, META_FILENAME);
	const tmpPath = `${path}.tmp-${randomUUID()}`;
	await writeFile(tmpPath, contents, "utf8");
	await rename(tmpPath, path);
};
const writeInitialMeta = async (lockPath, token) => {
	await writeMetaAtomic(lockPath, JSON.stringify({
		acquired_at: (/* @__PURE__ */ new Date()).toISOString(),
		pid: process.pid,
		token
	}));
};

//#endregion
//#region ../core/src/lock.ts
const RETRY_INTERVAL_MS = 100;
const DEFAULT_TIMEOUT_MS = 1e4;
const MAX_LOCK_AGE_MS = 6e5;
const MISSING_META_GRACE_MS = 5e3;
const STEAL_CLAIM_STALE_MS = 2e3;
const LOCK_NAME_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/u;
const isLockStale = async (lockPath) => {
	const meta = await readLockMeta(lockPath);
	if (meta === void 0) {
		const mtimeMs = await dirMtimeMs(lockPath);
		if (mtimeMs === void 0) return false;
		return Date.now() - mtimeMs > MISSING_META_GRACE_MS;
	}
	if (Date.now() - meta.acquiredAtMs > MAX_LOCK_AGE_MS) return true;
	return !isPidAlive(meta.pid);
};
const writeMetaOrRetrySignal = async (lockPath, token) => {
	try {
		await writeInitialMeta(lockPath, token);
	} catch (error) {
		if (errnoCode(error) === "ENOENT") return "retry";
		throw error;
	}
	return token;
};
const mkdirIfAbsent = async (lockPath) => {
	try {
		await mkdir(lockPath, { recursive: false });
		return true;
	} catch (error) {
		if (errnoCode(error) === "EEXIST") return false;
		throw error;
	}
};
const tryAcquire = async (lockPath) => {
	if (!await mkdirIfAbsent(lockPath)) return;
	const written = await writeMetaOrRetrySignal(lockPath, randomUUID());
	if (written === "retry") return tryAcquire(lockPath);
	return written;
};
const claimPathFor = (ctx) => join(ctx.locksDir, `${ctx.name}.steal-claim`);
const tombstonePathFor = (ctx) => join(ctx.locksDir, `${ctx.name}.steal.${randomUUID()}`);
const tryMkdirClaim = async (claimPath) => {
	try {
		await mkdir(claimPath, { recursive: false });
		return true;
	} catch (error) {
		if (errnoCode(error) === "EEXIST") return false;
		throw error;
	}
};
const isClaimStale = async (claimPath) => {
	const mtimeMs = await dirMtimeMs(claimPath);
	return mtimeMs !== void 0 && Date.now() - mtimeMs > STEAL_CLAIM_STALE_MS;
};
const acquireStealClaim = async (claimPath) => {
	if (await tryMkdirClaim(claimPath)) return true;
	if (!await isClaimStale(claimPath)) return false;
	await rm(claimPath, {
		force: true,
		recursive: true
	});
	return tryMkdirClaim(claimPath);
};
const renameToTombstoneOrNoop = async (ctx) => {
	const tombstonePath = tombstonePathFor(ctx);
	try {
		await rename(ctx.lockPath, tombstonePath);
	} catch (error) {
		if (errnoCode(error) === "ENOENT") return;
		throw error;
	}
	return tombstonePath;
};
const removeIfStillStale = async (ctx) => {
	if (!await isLockStale(ctx.lockPath)) return;
	const tombstonePath = await renameToTombstoneOrNoop(ctx);
	if (tombstonePath === void 0) return;
	await rm(tombstonePath, {
		force: true,
		recursive: true
	});
};
const stealStaleLock = async (ctx) => {
	const claimPath = claimPathFor(ctx);
	if (!await acquireStealClaim(claimPath)) return;
	try {
		await removeIfStillStale(ctx);
	} finally {
		await rm(claimPath, {
			force: true,
			recursive: true
		});
	}
};
const stealOrWait = async (ctx, deadline) => {
	if (await isLockStale(ctx.lockPath)) {
		await stealStaleLock(ctx);
		return;
	}
	if (Date.now() >= deadline) throw conflictError(`lock ${ctx.name} is held — another refs process is running`);
	await setTimeout(RETRY_INTERVAL_MS);
};
const acquireWithRetry = async (ctx, deadline) => {
	const token = await tryAcquire(ctx.lockPath);
	if (token !== void 0) return token;
	await stealOrWait(ctx, deadline);
	return acquireWithRetry(ctx, deadline);
};
const releaseIfOwned = async (lockPath, token) => {
	if (await readLockToken(lockPath) !== token) return;
	await rm(lockPath, {
		force: true,
		recursive: true
	});
};
const validateLockName = (name) => {
	if (name === "." || name === ".." || !LOCK_NAME_PATTERN.test(name)) throw validationError(`lock name must not contain "/" or other unsafe characters — only letters, digits, and "_.:-" are allowed, and it may not be "." or "..": ${name}`);
};
/**
* Runs `fn` while holding the named advisory lock, releasing it in `finally` (also on throw).
* Waits up to `opts.timeoutMs` (default 10s) for the lock, stealing it if abandoned; on timeout
* Rejects with a conflictError (exit code 5). `name` must match the strict allowlist enforced by
* `validateLockName` — ref-key callers replace `/` with `_` before calling (e.g.
* `ref:github.com_owner_repo`).
*/
const withLock = async (home, name, fn, opts) => {
	validateLockName(name);
	const ctx = {
		lockPath: join(home.locksDir, name),
		locksDir: home.locksDir,
		name
	};
	await mkdir(home.locksDir, { recursive: true });
	const deadline = Date.now() + (opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
	const token = await acquireWithRetry(ctx, deadline);
	try {
		return await fn();
	} finally {
		await releaseIfOwned(ctx.lockPath, token);
	}
};

//#endregion
//#region ../core/src/npm-resolver.ts
const zRepositoryObject = looseObject({
	directory: string().optional(),
	url: string().optional()
});
const zRepository = union([string(), zRepositoryObject]);
const zNpmPackument = looseObject({ repository: zRepository.optional() });
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9-~][a-z0-9._~-]*\/)?[a-z0-9-~][a-z0-9._~-]*$/u;
const PACKAGE_NAME_MAX_LENGTH = 214;
const RESERVED_UNSCOPED_NAMES = /* @__PURE__ */ new Set(["node_modules", "favicon.ico"]);
const SCOPED_NAME_PARTS = 2;
const SCOPED_NAME_INDEX = 1;
const HTTP_STATUS_NOT_FOUND = 404;
const HTTP_STATUS_OK = 200;
const noUsableRepositoryError = (pkgName) => notFoundError(`package '${pkgName}' has no usable repository field — find the repository and run: refs add <git-url>`);
const getUnscopedName = (pkgName) => {
	const parts = pkgName.split("/");
	if (parts.length >= SCOPED_NAME_PARTS) return parts[SCOPED_NAME_INDEX];
	return pkgName;
};
const validatePackageName = (pkgName) => {
	if (pkgName.length > PACKAGE_NAME_MAX_LENGTH) throw usageError(`invalid package name: '${pkgName}' exceeds maximum length of ${PACKAGE_NAME_MAX_LENGTH} characters`);
	if (!PACKAGE_NAME_PATTERN.test(pkgName)) throw usageError(`invalid package name: '${pkgName}' does not match npm naming rules`);
	const unscoped = getUnscopedName(pkgName);
	if (RESERVED_UNSCOPED_NAMES.has(unscoped)) throw usageError(`invalid package name: '${pkgName}' uses a reserved name`);
};
const encodePackageName = (pkgName) => pkgName.replace("/", "%2F");
const extractRepositoryUrl = (repository) => {
	if (typeof repository === "string") return repository;
	return repository?.url;
};
const extractDirectory = (repository) => {
	if (typeof repository === "object" && repository?.directory) {
		const result = zPackagePath.safeParse(repository.directory);
		if (result.success) return result.data;
	}
};
const parseResponseJson = async (response, pkgName) => {
	try {
		return await response.json();
	} catch {
		throw validationError(`invalid npm registry response for '${pkgName}': not parseable JSON`);
	}
};
const fetchPackument = async (fetcher, pkgName) => {
	const response = await fetcher(`https://registry.npmjs.org/${encodePackageName(pkgName)}`);
	if (response.status === HTTP_STATUS_NOT_FOUND) throw notFoundError(`npm package '${pkgName}' not found`);
	if (response.status !== HTTP_STATUS_OK) throw validationError(`failed to fetch npm package '${pkgName}': status ${response.status}`);
	const body = await parseResponseJson(response, pkgName);
	const parsed = zNpmPackument.safeParse(body);
	if (!parsed.success) throw validationError(`invalid npm package response for '${pkgName}'`);
	return parsed.data;
};
const canonicalizeRepository = (repositoryUrl, pkgName) => {
	try {
		return canonicalizeGitUrl(repositoryUrl);
	} catch {
		throw noUsableRepositoryError(pkgName);
	}
};
const resolveNpmPackage = async (fetcher, pkgName) => {
	validatePackageName(pkgName);
	const packument = await fetchPackument(fetcher, pkgName);
	const repositoryUrl = extractRepositoryUrl(packument.repository);
	if (repositoryUrl === void 0 || repositoryUrl === "") throw noUsableRepositoryError(pkgName);
	const { cloneUrl, key } = canonicalizeRepository(repositoryUrl, pkgName);
	const directory = extractDirectory(packument.repository);
	if (directory === void 0) return {
		cloneUrl,
		key
	};
	return {
		cloneUrl,
		directory,
		key
	};
};

//#endregion
//#region ../../node_modules/.pnpm/is-plain-obj@4.1.0/node_modules/is-plain-obj/index.js
function isPlainObject$1(value) {
	if (typeof value !== "object" || value === null) return false;
	const prototype = Object.getPrototypeOf(value);
	return (prototype === null || prototype === Object.prototype || Object.getPrototypeOf(prototype) === null) && !(Symbol.toStringTag in value) && !(Symbol.iterator in value);
}

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/file-url.js
const safeNormalizeFileUrl = (file, name) => {
	const fileString = normalizeFileUrl(normalizeDenoExecPath(file));
	if (typeof fileString !== "string") throw new TypeError(`${name} must be a string or a file URL: ${fileString}.`);
	return fileString;
};
const normalizeDenoExecPath = (file) => isDenoExecPath(file) ? file.toString() : file;
const isDenoExecPath = (file) => typeof file !== "string" && file && Object.getPrototypeOf(file) === String.prototype;
const normalizeFileUrl = (file) => file instanceof URL ? fileURLToPath(file) : file;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/parameters.js
const normalizeParameters = (rawFile, rawArguments = [], rawOptions = {}) => {
	const filePath = safeNormalizeFileUrl(rawFile, "First argument");
	const [commandArguments, options] = isPlainObject$1(rawArguments) ? [[], rawArguments] : [rawArguments, rawOptions];
	if (!Array.isArray(commandArguments)) throw new TypeError(`Second argument must be either an array of arguments or an options object: ${commandArguments}`);
	if (commandArguments.some((commandArgument) => typeof commandArgument === "object" && commandArgument !== null)) throw new TypeError(`Second argument must be an array of strings: ${commandArguments}`);
	const normalizedArguments = commandArguments.map(String);
	const nullByteArgument = normalizedArguments.find((normalizedArgument) => normalizedArgument.includes("\0"));
	if (nullByteArgument !== void 0) throw new TypeError(`Arguments cannot contain null bytes ("\\0"): ${nullByteArgument}`);
	if (!isPlainObject$1(options)) throw new TypeError(`Last argument must be an options object: ${options}`);
	return [
		filePath,
		normalizedArguments,
		options
	];
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/utils/uint-array.js
const { toString: objectToString$1 } = Object.prototype;
const isArrayBuffer = (value) => objectToString$1.call(value) === "[object ArrayBuffer]";
const isUint8Array = (value) => objectToString$1.call(value) === "[object Uint8Array]";
const bufferToUint8Array = (buffer) => new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
const textEncoder$1 = new TextEncoder();
const stringToUint8Array = (string) => textEncoder$1.encode(string);
const textDecoder = new TextDecoder();
const uint8ArrayToString = (uint8Array) => textDecoder.decode(uint8Array);
const joinToString = (uint8ArraysOrStrings, encoding) => {
	return uint8ArraysToStrings(uint8ArraysOrStrings, encoding).join("");
};
const uint8ArraysToStrings = (uint8ArraysOrStrings, encoding) => {
	if (encoding === "utf8" && uint8ArraysOrStrings.every((uint8ArrayOrString) => typeof uint8ArrayOrString === "string")) return uint8ArraysOrStrings;
	const decoder = new StringDecoder(encoding);
	const strings = uint8ArraysOrStrings.map((uint8ArrayOrString) => typeof uint8ArrayOrString === "string" ? stringToUint8Array(uint8ArrayOrString) : uint8ArrayOrString).map((uint8Array) => decoder.write(uint8Array));
	const finalString = decoder.end();
	return finalString === "" ? strings : [...strings, finalString];
};
const joinToUint8Array = (uint8ArraysOrStrings) => {
	if (uint8ArraysOrStrings.length === 1 && isUint8Array(uint8ArraysOrStrings[0])) return uint8ArraysOrStrings[0];
	return concatUint8Arrays(stringsToUint8Arrays(uint8ArraysOrStrings));
};
const stringsToUint8Arrays = (uint8ArraysOrStrings) => uint8ArraysOrStrings.map((uint8ArrayOrString) => typeof uint8ArrayOrString === "string" ? stringToUint8Array(uint8ArrayOrString) : uint8ArrayOrString);
const concatUint8Arrays = (uint8Arrays) => {
	const result = new Uint8Array(getJoinLength(uint8Arrays));
	let index = 0;
	for (const uint8Array of uint8Arrays) {
		result.set(uint8Array, index);
		index += uint8Array.length;
	}
	return result;
};
const getJoinLength = (uint8Arrays) => {
	let joinLength = 0;
	for (const uint8Array of uint8Arrays) joinLength += uint8Array.length;
	return joinLength;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/template.js
const isTemplateString = (templates) => Array.isArray(templates) && Array.isArray(templates.raw);
const parseTemplates = (templates, expressions) => {
	let tokens = [];
	for (const [index, template] of templates.entries()) tokens = parseTemplate({
		templates,
		expressions,
		tokens,
		index,
		template
	});
	if (tokens.length === 0) throw new TypeError("Template script must not be empty");
	const [file, ...commandArguments] = tokens;
	return [
		file,
		commandArguments,
		{}
	];
};
const parseTemplate = ({ templates, expressions, tokens, index, template }) => {
	if (template === void 0) throw new TypeError(`Invalid backslash sequence: ${templates.raw[index]}`);
	const { nextTokens, leadingWhitespaces, trailingWhitespaces } = splitByWhitespaces(template, templates.raw[index]);
	const newTokens = concatTokens(tokens, nextTokens, leadingWhitespaces);
	if (index === expressions.length) return newTokens;
	const expression = expressions[index];
	const expressionTokens = Array.isArray(expression) ? expression.map((expression) => parseExpression(expression)) : [parseExpression(expression)];
	return concatTokens(newTokens, expressionTokens, trailingWhitespaces);
};
const splitByWhitespaces = (template, rawTemplate) => {
	if (rawTemplate.length === 0) return {
		nextTokens: [],
		leadingWhitespaces: false,
		trailingWhitespaces: false
	};
	const nextTokens = [];
	let templateStart = 0;
	const leadingWhitespaces = DELIMITERS.has(rawTemplate[0]);
	for (let templateIndex = 0, rawIndex = 0; templateIndex < template.length; templateIndex += 1, rawIndex += 1) {
		const rawCharacter = rawTemplate[rawIndex];
		if (DELIMITERS.has(rawCharacter)) {
			if (templateStart !== templateIndex) nextTokens.push(template.slice(templateStart, templateIndex));
			templateStart = templateIndex + 1;
		} else if (rawCharacter === "\\") {
			const nextRawCharacter = rawTemplate[rawIndex + 1];
			if (nextRawCharacter === "\n") {
				templateIndex -= 1;
				rawIndex += 1;
			} else if (nextRawCharacter === "u" && rawTemplate[rawIndex + 2] === "{") rawIndex = rawTemplate.indexOf("}", rawIndex + 3);
			else rawIndex += ESCAPE_LENGTH[nextRawCharacter] ?? 1;
		}
	}
	const trailingWhitespaces = templateStart === template.length;
	if (!trailingWhitespaces) nextTokens.push(template.slice(templateStart));
	return {
		nextTokens,
		leadingWhitespaces,
		trailingWhitespaces
	};
};
const DELIMITERS = /* @__PURE__ */ new Set([
	" ",
	"	",
	"\r",
	"\n"
]);
const ESCAPE_LENGTH = {
	x: 3,
	u: 5
};
const concatTokens = (tokens, nextTokens, isSeparated) => isSeparated || tokens.length === 0 || nextTokens.length === 0 ? [...tokens, ...nextTokens] : [
	...tokens.slice(0, -1),
	`${tokens.at(-1)}${nextTokens[0]}`,
	...nextTokens.slice(1)
];
const parseExpression = (expression) => {
	const typeOfExpression = typeof expression;
	if (typeOfExpression === "string") return expression;
	if (typeOfExpression === "number") return String(expression);
	if (isPlainObject$1(expression) && ("stdout" in expression || "isMaxBuffer" in expression)) return getSubprocessResult(expression);
	if (expression instanceof ChildProcess || Object.prototype.toString.call(expression) === "[object Promise]") throw new TypeError("Unexpected subprocess in template expression. Please use ${await subprocess} instead of ${subprocess}.");
	throw new TypeError(`Unexpected "${typeOfExpression}" in template expression`);
};
const getSubprocessResult = ({ stdout }) => {
	if (typeof stdout === "string") return stdout;
	if (isUint8Array(stdout)) return uint8ArrayToString(stdout);
	if (stdout === void 0) throw new TypeError("Missing result.stdout in template expression. This is probably due to the previous subprocess' \"stdout\" option.");
	throw new TypeError(`Unexpected "${typeof stdout}" stdout in template expression`);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/utils/standard-stream.js
const isStandardStream = (stream) => STANDARD_STREAMS.includes(stream);
const STANDARD_STREAMS = [
	process$1.stdin,
	process$1.stdout,
	process$1.stderr
];
const STANDARD_STREAMS_ALIASES = [
	"stdin",
	"stdout",
	"stderr"
];
const getStreamName = (fdNumber) => STANDARD_STREAMS_ALIASES[fdNumber] ?? `stdio[${fdNumber}]`;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/specific.js
const normalizeFdSpecificOptions = (options) => {
	const optionsCopy = { ...options };
	for (const optionName of FD_SPECIFIC_OPTIONS) optionsCopy[optionName] = normalizeFdSpecificOption(options, optionName);
	return optionsCopy;
};
const normalizeFdSpecificOption = (options, optionName) => {
	const optionBaseArray = Array.from({ length: getStdioLength(options) + 1 });
	const optionArray = normalizeFdSpecificValue(options[optionName], optionBaseArray, optionName);
	return addDefaultValue$1(optionArray, optionName);
};
const getStdioLength = ({ stdio }) => Array.isArray(stdio) ? Math.max(stdio.length, STANDARD_STREAMS_ALIASES.length) : STANDARD_STREAMS_ALIASES.length;
const normalizeFdSpecificValue = (optionValue, optionArray, optionName) => isPlainObject$1(optionValue) ? normalizeOptionObject(optionValue, optionArray, optionName) : optionArray.fill(optionValue);
const normalizeOptionObject = (optionValue, optionArray, optionName) => {
	for (const fdName of Object.keys(optionValue).sort(compareFdName)) for (const fdNumber of parseFdName(fdName, optionName, optionArray)) optionArray[fdNumber] = optionValue[fdName];
	return optionArray;
};
const compareFdName = (fdNameA, fdNameB) => getFdNameOrder(fdNameA) < getFdNameOrder(fdNameB) ? 1 : -1;
const getFdNameOrder = (fdName) => {
	if (fdName === "stdout" || fdName === "stderr") return 0;
	return fdName === "all" ? 2 : 1;
};
const parseFdName = (fdName, optionName, optionArray) => {
	if (fdName === "ipc") return [optionArray.length - 1];
	const fdNumber = parseFd(fdName);
	if (fdNumber === void 0 || fdNumber === 0) throw new TypeError(`"${optionName}.${fdName}" is invalid.
It must be "${optionName}.stdout", "${optionName}.stderr", "${optionName}.all", "${optionName}.ipc", or "${optionName}.fd3", "${optionName}.fd4" (and so on).`);
	if (fdNumber >= optionArray.length) throw new TypeError(`"${optionName}.${fdName}" is invalid: that file descriptor does not exist.
Please set the "stdio" option to ensure that file descriptor exists.`);
	return fdNumber === "all" ? [1, 2] : [fdNumber];
};
const parseFd = (fdName) => {
	if (fdName === "all") return fdName;
	if (STANDARD_STREAMS_ALIASES.includes(fdName)) return STANDARD_STREAMS_ALIASES.indexOf(fdName);
	const regexpResult = FD_REGEXP.exec(fdName);
	if (regexpResult !== null) return Number(regexpResult[1]);
};
const FD_REGEXP = /^fd(\d+)$/;
const addDefaultValue$1 = (optionArray, optionName) => optionArray.map((optionValue) => optionValue === void 0 ? DEFAULT_OPTIONS[optionName] : optionValue);
const DEFAULT_OPTIONS = {
	lines: false,
	buffer: true,
	maxBuffer: 1e3 * 1e3 * 100,
	verbose: debuglog("execa").enabled ? "full" : "none",
	stripFinalNewline: true
};
const FD_SPECIFIC_OPTIONS = [
	"lines",
	"buffer",
	"maxBuffer",
	"verbose",
	"stripFinalNewline"
];
const getFdSpecificValue = (optionArray, fdNumber) => fdNumber === "ipc" ? optionArray.at(-1) : optionArray[fdNumber];

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/values.js
const isVerbose = ({ verbose }, fdNumber) => getFdVerbose(verbose, fdNumber) !== "none";
const isFullVerbose = ({ verbose }, fdNumber) => !["none", "short"].includes(getFdVerbose(verbose, fdNumber));
const getVerboseFunction = ({ verbose }, fdNumber) => {
	const fdVerbose = getFdVerbose(verbose, fdNumber);
	return isVerboseFunction(fdVerbose) ? fdVerbose : void 0;
};
const getFdVerbose = (verbose, fdNumber) => fdNumber === void 0 ? getFdGenericVerbose(verbose) : getFdSpecificValue(verbose, fdNumber);
const getFdGenericVerbose = (verbose) => verbose.find((fdVerbose) => isVerboseFunction(fdVerbose)) ?? VERBOSE_VALUES.findLast((fdVerbose) => verbose.includes(fdVerbose));
const isVerboseFunction = (fdVerbose) => typeof fdVerbose === "function";
const VERBOSE_VALUES = [
	"none",
	"short",
	"full"
];

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/escape.js
const joinCommand = (filePath, rawArguments) => {
	const fileAndArguments = [filePath, ...rawArguments];
	return {
		command: fileAndArguments.join(" "),
		escapedCommand: fileAndArguments.map((fileAndArgument) => quoteString(escapeControlCharacters(fileAndArgument))).join(" ")
	};
};
const escapeLines = (lines) => stripVTControlCharacters(lines).split("\n").map((line) => escapeControlCharacters(line)).join("\n");
const escapeControlCharacters = (line) => line.replaceAll(SPECIAL_CHAR_REGEXP, (character) => escapeControlCharacter(character));
const escapeControlCharacter = (character) => {
	const commonEscape = COMMON_ESCAPES[character];
	if (commonEscape !== void 0) return commonEscape;
	const codepoint = character.codePointAt(0);
	const codepointHex = codepoint.toString(16);
	return codepoint <= ASTRAL_START ? `\\u${codepointHex.padStart(4, "0")}` : `\\U${codepointHex}`;
};
const getSpecialCharRegExp = () => {
	try {
		return /* @__PURE__ */ new RegExp("\\p{Separator}|\\p{Other}", "gu");
	} catch {
		return /[\s\u0000-\u001F\u007F-\u009F\u00AD]/g;
	}
};
const SPECIAL_CHAR_REGEXP = getSpecialCharRegExp();
const COMMON_ESCAPES = {
	" ": " ",
	"\b": "\\b",
	"\f": "\\f",
	"\n": "\\n",
	"\r": "\\r",
	"	": "\\t"
};
const ASTRAL_START = 65535;
const quoteString = (escapedArgument) => {
	if (NO_ESCAPE_REGEXP.test(escapedArgument)) return escapedArgument;
	return platform === "win32" ? `"${escapedArgument.replaceAll("\"", "\"\"")}"` : `'${escapedArgument.replaceAll("'", "'\\''")}'`;
};
const NO_ESCAPE_REGEXP = /^[\w./-]+$/;

//#endregion
//#region ../../node_modules/.pnpm/is-unicode-supported@2.1.0/node_modules/is-unicode-supported/index.js
function isUnicodeSupported() {
	const { env } = process$1;
	const { TERM, TERM_PROGRAM } = env;
	if (process$1.platform !== "win32") return TERM !== "linux";
	return Boolean(env.WT_SESSION) || Boolean(env.TERMINUS_SUBLIME) || env.ConEmuTask === "{cmd::Cmder}" || TERM_PROGRAM === "Terminus-Sublime" || TERM_PROGRAM === "vscode" || TERM === "xterm-256color" || TERM === "alacritty" || TERM === "rxvt-unicode" || TERM === "rxvt-unicode-256color" || env.TERMINAL_EMULATOR === "JetBrains-JediTerm";
}

//#endregion
//#region ../../node_modules/.pnpm/figures@6.1.0/node_modules/figures/index.js
const common = {
	circleQuestionMark: "(?)",
	questionMarkPrefix: "(?)",
	square: "█",
	squareDarkShade: "▓",
	squareMediumShade: "▒",
	squareLightShade: "░",
	squareTop: "▀",
	squareBottom: "▄",
	squareLeft: "▌",
	squareRight: "▐",
	squareCenter: "■",
	bullet: "●",
	dot: "․",
	ellipsis: "…",
	pointerSmall: "›",
	triangleUp: "▲",
	triangleUpSmall: "▴",
	triangleDown: "▼",
	triangleDownSmall: "▾",
	triangleLeftSmall: "◂",
	triangleRightSmall: "▸",
	home: "⌂",
	heart: "♥",
	musicNote: "♪",
	musicNoteBeamed: "♫",
	arrowUp: "↑",
	arrowDown: "↓",
	arrowLeft: "←",
	arrowRight: "→",
	arrowLeftRight: "↔",
	arrowUpDown: "↕",
	almostEqual: "≈",
	notEqual: "≠",
	lessOrEqual: "≤",
	greaterOrEqual: "≥",
	identical: "≡",
	infinity: "∞",
	subscriptZero: "₀",
	subscriptOne: "₁",
	subscriptTwo: "₂",
	subscriptThree: "₃",
	subscriptFour: "₄",
	subscriptFive: "₅",
	subscriptSix: "₆",
	subscriptSeven: "₇",
	subscriptEight: "₈",
	subscriptNine: "₉",
	oneHalf: "½",
	oneThird: "⅓",
	oneQuarter: "¼",
	oneFifth: "⅕",
	oneSixth: "⅙",
	oneEighth: "⅛",
	twoThirds: "⅔",
	twoFifths: "⅖",
	threeQuarters: "¾",
	threeFifths: "⅗",
	threeEighths: "⅜",
	fourFifths: "⅘",
	fiveSixths: "⅚",
	fiveEighths: "⅝",
	sevenEighths: "⅞",
	line: "─",
	lineBold: "━",
	lineDouble: "═",
	lineDashed0: "┄",
	lineDashed1: "┅",
	lineDashed2: "┈",
	lineDashed3: "┉",
	lineDashed4: "╌",
	lineDashed5: "╍",
	lineDashed6: "╴",
	lineDashed7: "╶",
	lineDashed8: "╸",
	lineDashed9: "╺",
	lineDashed10: "╼",
	lineDashed11: "╾",
	lineDashed12: "−",
	lineDashed13: "–",
	lineDashed14: "‐",
	lineDashed15: "⁃",
	lineVertical: "│",
	lineVerticalBold: "┃",
	lineVerticalDouble: "║",
	lineVerticalDashed0: "┆",
	lineVerticalDashed1: "┇",
	lineVerticalDashed2: "┊",
	lineVerticalDashed3: "┋",
	lineVerticalDashed4: "╎",
	lineVerticalDashed5: "╏",
	lineVerticalDashed6: "╵",
	lineVerticalDashed7: "╷",
	lineVerticalDashed8: "╹",
	lineVerticalDashed9: "╻",
	lineVerticalDashed10: "╽",
	lineVerticalDashed11: "╿",
	lineDownLeft: "┐",
	lineDownLeftArc: "╮",
	lineDownBoldLeftBold: "┓",
	lineDownBoldLeft: "┒",
	lineDownLeftBold: "┑",
	lineDownDoubleLeftDouble: "╗",
	lineDownDoubleLeft: "╖",
	lineDownLeftDouble: "╕",
	lineDownRight: "┌",
	lineDownRightArc: "╭",
	lineDownBoldRightBold: "┏",
	lineDownBoldRight: "┎",
	lineDownRightBold: "┍",
	lineDownDoubleRightDouble: "╔",
	lineDownDoubleRight: "╓",
	lineDownRightDouble: "╒",
	lineUpLeft: "┘",
	lineUpLeftArc: "╯",
	lineUpBoldLeftBold: "┛",
	lineUpBoldLeft: "┚",
	lineUpLeftBold: "┙",
	lineUpDoubleLeftDouble: "╝",
	lineUpDoubleLeft: "╜",
	lineUpLeftDouble: "╛",
	lineUpRight: "└",
	lineUpRightArc: "╰",
	lineUpBoldRightBold: "┗",
	lineUpBoldRight: "┖",
	lineUpRightBold: "┕",
	lineUpDoubleRightDouble: "╚",
	lineUpDoubleRight: "╙",
	lineUpRightDouble: "╘",
	lineUpDownLeft: "┤",
	lineUpBoldDownBoldLeftBold: "┫",
	lineUpBoldDownBoldLeft: "┨",
	lineUpDownLeftBold: "┥",
	lineUpBoldDownLeftBold: "┩",
	lineUpDownBoldLeftBold: "┪",
	lineUpDownBoldLeft: "┧",
	lineUpBoldDownLeft: "┦",
	lineUpDoubleDownDoubleLeftDouble: "╣",
	lineUpDoubleDownDoubleLeft: "╢",
	lineUpDownLeftDouble: "╡",
	lineUpDownRight: "├",
	lineUpBoldDownBoldRightBold: "┣",
	lineUpBoldDownBoldRight: "┠",
	lineUpDownRightBold: "┝",
	lineUpBoldDownRightBold: "┡",
	lineUpDownBoldRightBold: "┢",
	lineUpDownBoldRight: "┟",
	lineUpBoldDownRight: "┞",
	lineUpDoubleDownDoubleRightDouble: "╠",
	lineUpDoubleDownDoubleRight: "╟",
	lineUpDownRightDouble: "╞",
	lineDownLeftRight: "┬",
	lineDownBoldLeftBoldRightBold: "┳",
	lineDownLeftBoldRightBold: "┯",
	lineDownBoldLeftRight: "┰",
	lineDownBoldLeftBoldRight: "┱",
	lineDownBoldLeftRightBold: "┲",
	lineDownLeftRightBold: "┮",
	lineDownLeftBoldRight: "┭",
	lineDownDoubleLeftDoubleRightDouble: "╦",
	lineDownDoubleLeftRight: "╥",
	lineDownLeftDoubleRightDouble: "╤",
	lineUpLeftRight: "┴",
	lineUpBoldLeftBoldRightBold: "┻",
	lineUpLeftBoldRightBold: "┷",
	lineUpBoldLeftRight: "┸",
	lineUpBoldLeftBoldRight: "┹",
	lineUpBoldLeftRightBold: "┺",
	lineUpLeftRightBold: "┶",
	lineUpLeftBoldRight: "┵",
	lineUpDoubleLeftDoubleRightDouble: "╩",
	lineUpDoubleLeftRight: "╨",
	lineUpLeftDoubleRightDouble: "╧",
	lineUpDownLeftRight: "┼",
	lineUpBoldDownBoldLeftBoldRightBold: "╋",
	lineUpDownBoldLeftBoldRightBold: "╈",
	lineUpBoldDownLeftBoldRightBold: "╇",
	lineUpBoldDownBoldLeftRightBold: "╊",
	lineUpBoldDownBoldLeftBoldRight: "╉",
	lineUpBoldDownLeftRight: "╀",
	lineUpDownBoldLeftRight: "╁",
	lineUpDownLeftBoldRight: "┽",
	lineUpDownLeftRightBold: "┾",
	lineUpBoldDownBoldLeftRight: "╂",
	lineUpDownLeftBoldRightBold: "┿",
	lineUpBoldDownLeftBoldRight: "╃",
	lineUpBoldDownLeftRightBold: "╄",
	lineUpDownBoldLeftBoldRight: "╅",
	lineUpDownBoldLeftRightBold: "╆",
	lineUpDoubleDownDoubleLeftDoubleRightDouble: "╬",
	lineUpDoubleDownDoubleLeftRight: "╫",
	lineUpDownLeftDoubleRightDouble: "╪",
	lineCross: "╳",
	lineBackslash: "╲",
	lineSlash: "╱"
};
const specialMainSymbols = {
	tick: "✔",
	info: "ℹ",
	warning: "⚠",
	cross: "✘",
	squareSmall: "◻",
	squareSmallFilled: "◼",
	circle: "◯",
	circleFilled: "◉",
	circleDotted: "◌",
	circleDouble: "◎",
	circleCircle: "ⓞ",
	circleCross: "ⓧ",
	circlePipe: "Ⓘ",
	radioOn: "◉",
	radioOff: "◯",
	checkboxOn: "☒",
	checkboxOff: "☐",
	checkboxCircleOn: "ⓧ",
	checkboxCircleOff: "Ⓘ",
	pointer: "❯",
	triangleUpOutline: "△",
	triangleLeft: "◀",
	triangleRight: "▶",
	lozenge: "◆",
	lozengeOutline: "◇",
	hamburger: "☰",
	smiley: "㋡",
	mustache: "෴",
	star: "★",
	play: "▶",
	nodejs: "⬢",
	oneSeventh: "⅐",
	oneNinth: "⅑",
	oneTenth: "⅒"
};
const specialFallbackSymbols = {
	tick: "√",
	info: "i",
	warning: "‼",
	cross: "×",
	squareSmall: "□",
	squareSmallFilled: "■",
	circle: "( )",
	circleFilled: "(*)",
	circleDotted: "( )",
	circleDouble: "( )",
	circleCircle: "(○)",
	circleCross: "(×)",
	circlePipe: "(│)",
	radioOn: "(*)",
	radioOff: "( )",
	checkboxOn: "[×]",
	checkboxOff: "[ ]",
	checkboxCircleOn: "(×)",
	checkboxCircleOff: "( )",
	pointer: ">",
	triangleUpOutline: "∆",
	triangleLeft: "◄",
	triangleRight: "►",
	lozenge: "♦",
	lozengeOutline: "◊",
	hamburger: "≡",
	smiley: "☺",
	mustache: "┌─┐",
	star: "✶",
	play: "►",
	nodejs: "♦",
	oneSeventh: "1/7",
	oneNinth: "1/9",
	oneTenth: "1/10"
};
const mainSymbols = {
	...common,
	...specialMainSymbols
};
const fallbackSymbols = {
	...common,
	...specialFallbackSymbols
};
const shouldUseMain = isUnicodeSupported();
const figures = shouldUseMain ? mainSymbols : fallbackSymbols;
const replacements = Object.entries(specialMainSymbols);

//#endregion
//#region ../../node_modules/.pnpm/yoctocolors@2.1.2/node_modules/yoctocolors/base.js
const hasColors = tty?.WriteStream?.prototype?.hasColors?.() ?? false;
const format = (open, close) => {
	if (!hasColors) return (input) => input;
	const openCode = `\u001B[${open}m`;
	const closeCode = `\u001B[${close}m`;
	return (input) => {
		const string = input + "";
		let index = string.indexOf(closeCode);
		if (index === -1) return openCode + string + closeCode;
		let result = openCode;
		let lastIndex = 0;
		const replaceCode = (close === 22 ? closeCode : "") + openCode;
		while (index !== -1) {
			result += string.slice(lastIndex, index) + replaceCode;
			lastIndex = index + closeCode.length;
			index = string.indexOf(closeCode, lastIndex);
		}
		result += string.slice(lastIndex) + closeCode;
		return result;
	};
};
const reset = format(0, 0);
const bold = format(1, 22);
const dim = format(2, 22);
const italic = format(3, 23);
const underline = format(4, 24);
const overline = format(53, 55);
const inverse = format(7, 27);
const hidden = format(8, 28);
const strikethrough = format(9, 29);
const black = format(30, 39);
const red = format(31, 39);
const green = format(32, 39);
const yellow = format(33, 39);
const blue = format(34, 39);
const magenta = format(35, 39);
const cyan = format(36, 39);
const white = format(37, 39);
const gray = format(90, 39);
const bgBlack = format(40, 49);
const bgRed = format(41, 49);
const bgGreen = format(42, 49);
const bgYellow = format(43, 49);
const bgBlue = format(44, 49);
const bgMagenta = format(45, 49);
const bgCyan = format(46, 49);
const bgWhite = format(47, 49);
const bgGray = format(100, 49);
const redBright = format(91, 39);
const greenBright = format(92, 39);
const yellowBright = format(93, 39);
const blueBright = format(94, 39);
const magentaBright = format(95, 39);
const cyanBright = format(96, 39);
const whiteBright = format(97, 39);
const bgRedBright = format(101, 49);
const bgGreenBright = format(102, 49);
const bgYellowBright = format(103, 49);
const bgBlueBright = format(104, 49);
const bgMagentaBright = format(105, 49);
const bgCyanBright = format(106, 49);
const bgWhiteBright = format(107, 49);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/default.js
const defaultVerboseFunction = ({ type, message, timestamp, piped, commandId, result: { failed = false } = {}, options: { reject = true } }) => {
	const timestampString = serializeTimestamp(timestamp);
	const icon = ICONS[type]({
		failed,
		reject,
		piped
	});
	const color = COLORS[type]({ reject });
	return `${gray(`[${timestampString}]`)} ${gray(`[${commandId}]`)} ${color(icon)} ${color(message)}`;
};
const serializeTimestamp = (timestamp) => `${padField(timestamp.getHours(), 2)}:${padField(timestamp.getMinutes(), 2)}:${padField(timestamp.getSeconds(), 2)}.${padField(timestamp.getMilliseconds(), 3)}`;
const padField = (field, padding) => String(field).padStart(padding, "0");
const getFinalIcon = ({ failed, reject }) => {
	if (!failed) return figures.tick;
	return reject ? figures.cross : figures.warning;
};
const ICONS = {
	command: ({ piped }) => piped ? "|" : "$",
	output: () => " ",
	ipc: () => "*",
	error: getFinalIcon,
	duration: getFinalIcon
};
const identity$1 = (string) => string;
const COLORS = {
	command: () => bold,
	output: () => identity$1,
	ipc: () => identity$1,
	error: ({ reject }) => reject ? redBright : yellowBright,
	duration: () => gray
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/custom.js
const applyVerboseOnLines = (printedLines, verboseInfo, fdNumber) => {
	const verboseFunction = getVerboseFunction(verboseInfo, fdNumber);
	return printedLines.map(({ verboseLine, verboseObject }) => applyVerboseFunction(verboseLine, verboseObject, verboseFunction)).filter((printedLine) => printedLine !== void 0).map((printedLine) => appendNewline(printedLine)).join("");
};
const applyVerboseFunction = (verboseLine, verboseObject, verboseFunction) => {
	if (verboseFunction === void 0) return verboseLine;
	const printedLine = verboseFunction(verboseLine, verboseObject);
	if (typeof printedLine === "string") return printedLine;
};
const appendNewline = (printedLine) => printedLine.endsWith("\n") ? printedLine : `${printedLine}\n`;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/log.js
const verboseLog = ({ type, verboseMessage, fdNumber, verboseInfo, result }) => {
	const verboseObject = getVerboseObject({
		type,
		result,
		verboseInfo
	});
	const finalLines = applyVerboseOnLines(getPrintedLines(verboseMessage, verboseObject), verboseInfo, fdNumber);
	if (finalLines !== "") console.warn(finalLines.slice(0, -1));
};
const getVerboseObject = ({ type, result, verboseInfo: { escapedCommand, commandId, rawOptions: { piped = false, ...options } } }) => ({
	type,
	escapedCommand,
	commandId: `${commandId}`,
	timestamp: /* @__PURE__ */ new Date(),
	piped,
	result,
	options
});
const getPrintedLines = (verboseMessage, verboseObject) => verboseMessage.split("\n").map((message) => getPrintedLine({
	...verboseObject,
	message
}));
const getPrintedLine = (verboseObject) => {
	return {
		verboseLine: defaultVerboseFunction(verboseObject),
		verboseObject
	};
};
const serializeVerboseMessage = (message) => {
	return escapeLines(typeof message === "string" ? message : inspect(message)).replaceAll("	", " ".repeat(TAB_SIZE));
};
const TAB_SIZE = 2;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/start.js
const logCommand = (escapedCommand, verboseInfo) => {
	if (!isVerbose(verboseInfo)) return;
	verboseLog({
		type: "command",
		verboseMessage: escapedCommand,
		verboseInfo
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/info.js
const getVerboseInfo = (verbose, escapedCommand, rawOptions) => {
	validateVerbose(verbose);
	return {
		verbose,
		escapedCommand,
		commandId: getCommandId(verbose),
		rawOptions
	};
};
const getCommandId = (verbose) => isVerbose({ verbose }) ? COMMAND_ID++ : void 0;
let COMMAND_ID = 0n;
const validateVerbose = (verbose) => {
	for (const fdVerbose of verbose) {
		if (fdVerbose === false) throw new TypeError("The \"verbose: false\" option was renamed to \"verbose: 'none'\".");
		if (fdVerbose === true) throw new TypeError("The \"verbose: true\" option was renamed to \"verbose: 'short'\".");
		if (!VERBOSE_VALUES.includes(fdVerbose) && !isVerboseFunction(fdVerbose)) {
			const allowedValues = VERBOSE_VALUES.map((allowedValue) => `'${allowedValue}'`).join(", ");
			throw new TypeError(`The "verbose" option must not be ${fdVerbose}. Allowed values are: ${allowedValues} or a function.`);
		}
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/duration.js
const getStartTime = () => hrtime.bigint();
const getDurationMs = (startTime) => Number(hrtime.bigint() - startTime) / 1e6;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/command.js
const handleCommand = (filePath, rawArguments, rawOptions) => {
	const startTime = getStartTime();
	const { command, escapedCommand } = joinCommand(filePath, rawArguments);
	const verboseInfo = getVerboseInfo(normalizeFdSpecificOption(rawOptions, "verbose"), escapedCommand, { ...rawOptions });
	logCommand(escapedCommand, verboseInfo);
	return {
		command,
		escapedCommand,
		startTime,
		verboseInfo
	};
};

//#endregion
//#region ../../node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/windows.js
var require_windows = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = isexe;
	isexe.sync = sync;
	var fs$3 = __require("fs");
	function checkPathExt(path, options) {
		var pathext = options.pathExt !== void 0 ? options.pathExt : process.env.PATHEXT;
		if (!pathext) return true;
		pathext = pathext.split(";");
		if (pathext.indexOf("") !== -1) return true;
		for (var i = 0; i < pathext.length; i++) {
			var p = pathext[i].toLowerCase();
			if (p && path.substr(-p.length).toLowerCase() === p) return true;
		}
		return false;
	}
	function checkStat(stat, path, options) {
		if (!stat.isSymbolicLink() && !stat.isFile()) return false;
		return checkPathExt(path, options);
	}
	function isexe(path, options, cb) {
		fs$3.stat(path, function(er, stat) {
			cb(er, er ? false : checkStat(stat, path, options));
		});
	}
	function sync(path, options) {
		return checkStat(fs$3.statSync(path), path, options);
	}
}));

//#endregion
//#region ../../node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/mode.js
var require_mode = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = isexe;
	isexe.sync = sync;
	var fs$2 = __require("fs");
	function isexe(path, options, cb) {
		fs$2.stat(path, function(er, stat) {
			cb(er, er ? false : checkStat(stat, options));
		});
	}
	function sync(path, options) {
		return checkStat(fs$2.statSync(path), options);
	}
	function checkStat(stat, options) {
		return stat.isFile() && checkMode(stat, options);
	}
	function checkMode(stat, options) {
		var mod = stat.mode;
		var uid = stat.uid;
		var gid = stat.gid;
		var myUid = options.uid !== void 0 ? options.uid : process.getuid && process.getuid();
		var myGid = options.gid !== void 0 ? options.gid : process.getgid && process.getgid();
		var u = parseInt("100", 8);
		var g = parseInt("010", 8);
		var o = parseInt("001", 8);
		var ug = u | g;
		return mod & o || mod & g && gid === myGid || mod & u && uid === myUid || mod & ug && myUid === 0;
	}
}));

//#endregion
//#region ../../node_modules/.pnpm/isexe@2.0.0/node_modules/isexe/index.js
var require_isexe = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	__require("fs");
	var core;
	if (process.platform === "win32" || global.TESTING_WINDOWS) core = require_windows();
	else core = require_mode();
	module.exports = isexe;
	isexe.sync = sync;
	function isexe(path, options, cb) {
		if (typeof options === "function") {
			cb = options;
			options = {};
		}
		if (!cb) {
			if (typeof Promise !== "function") throw new TypeError("callback not provided");
			return new Promise(function(resolve, reject) {
				isexe(path, options || {}, function(er, is) {
					if (er) reject(er);
					else resolve(is);
				});
			});
		}
		core(path, options || {}, function(er, is) {
			if (er) {
				if (er.code === "EACCES" || options && options.ignoreErrors) {
					er = null;
					is = false;
				}
			}
			cb(er, is);
		});
	}
	function sync(path, options) {
		try {
			return core.sync(path, options || {});
		} catch (er) {
			if (options && options.ignoreErrors || er.code === "EACCES") return false;
			else throw er;
		}
	}
}));

//#endregion
//#region ../../node_modules/.pnpm/which@2.0.2/node_modules/which/which.js
var require_which = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const isWindows = process.platform === "win32" || process.env.OSTYPE === "cygwin" || process.env.OSTYPE === "msys";
	const path$3 = __require("path");
	const COLON = isWindows ? ";" : ":";
	const isexe = require_isexe();
	const getNotFoundError = (cmd) => Object.assign(/* @__PURE__ */ new Error(`not found: ${cmd}`), { code: "ENOENT" });
	const getPathInfo = (cmd, opt) => {
		const colon = opt.colon || COLON;
		const pathEnv = cmd.match(/\//) || isWindows && cmd.match(/\\/) ? [""] : [...isWindows ? [process.cwd()] : [], ...(opt.path || process.env.PATH || "").split(colon)];
		const pathExtExe = isWindows ? opt.pathExt || process.env.PATHEXT || ".EXE;.CMD;.BAT;.COM" : "";
		const pathExt = isWindows ? pathExtExe.split(colon) : [""];
		if (isWindows) {
			if (cmd.indexOf(".") !== -1 && pathExt[0] !== "") pathExt.unshift("");
		}
		return {
			pathEnv,
			pathExt,
			pathExtExe
		};
	};
	const which = (cmd, opt, cb) => {
		if (typeof opt === "function") {
			cb = opt;
			opt = {};
		}
		if (!opt) opt = {};
		const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
		const found = [];
		const step = (i) => new Promise((resolve, reject) => {
			if (i === pathEnv.length) return opt.all && found.length ? resolve(found) : reject(getNotFoundError(cmd));
			const ppRaw = pathEnv[i];
			const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
			const pCmd = path$3.join(pathPart, cmd);
			const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
			resolve(subStep(p, i, 0));
		});
		const subStep = (p, i, ii) => new Promise((resolve, reject) => {
			if (ii === pathExt.length) return resolve(step(i + 1));
			const ext = pathExt[ii];
			isexe(p + ext, { pathExt: pathExtExe }, (er, is) => {
				if (!er && is) if (opt.all) found.push(p + ext);
				else return resolve(p + ext);
				return resolve(subStep(p, i, ii + 1));
			});
		});
		return cb ? step(0).then((res) => cb(null, res), cb) : step(0);
	};
	const whichSync = (cmd, opt) => {
		opt = opt || {};
		const { pathEnv, pathExt, pathExtExe } = getPathInfo(cmd, opt);
		const found = [];
		for (let i = 0; i < pathEnv.length; i++) {
			const ppRaw = pathEnv[i];
			const pathPart = /^".*"$/.test(ppRaw) ? ppRaw.slice(1, -1) : ppRaw;
			const pCmd = path$3.join(pathPart, cmd);
			const p = !pathPart && /^\.[\\\/]/.test(cmd) ? cmd.slice(0, 2) + pCmd : pCmd;
			for (let j = 0; j < pathExt.length; j++) {
				const cur = p + pathExt[j];
				try {
					if (isexe.sync(cur, { pathExt: pathExtExe })) if (opt.all) found.push(cur);
					else return cur;
				} catch (ex) {}
			}
		}
		if (opt.all && found.length) return found;
		if (opt.nothrow) return null;
		throw getNotFoundError(cmd);
	};
	module.exports = which;
	which.sync = whichSync;
}));

//#endregion
//#region ../../node_modules/.pnpm/path-key@3.1.1/node_modules/path-key/index.js
var require_path_key = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const pathKey = (options = {}) => {
		const environment = options.env || process.env;
		if ((options.platform || process.platform) !== "win32") return "PATH";
		return Object.keys(environment).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
	};
	module.exports = pathKey;
	module.exports.default = pathKey;
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/resolveCommand.js
var require_resolveCommand = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const path$2 = __require("path");
	const which = require_which();
	const getPathKey = require_path_key();
	function resolveCommandAttempt(parsed, withoutPathExt) {
		const env = parsed.options.env || process.env;
		const cwd = process.cwd();
		const hasCustomCwd = parsed.options.cwd != null;
		const shouldSwitchCwd = hasCustomCwd && process.chdir !== void 0 && !process.chdir.disabled;
		if (shouldSwitchCwd) try {
			process.chdir(parsed.options.cwd);
		} catch (err) {}
		let resolved;
		try {
			resolved = which.sync(parsed.command, {
				path: env[getPathKey({ env })],
				pathExt: withoutPathExt ? path$2.delimiter : void 0
			});
		} catch (e) {} finally {
			if (shouldSwitchCwd) process.chdir(cwd);
		}
		if (resolved) resolved = path$2.resolve(hasCustomCwd ? parsed.options.cwd : "", resolved);
		return resolved;
	}
	function resolveCommand(parsed) {
		return resolveCommandAttempt(parsed) || resolveCommandAttempt(parsed, true);
	}
	module.exports = resolveCommand;
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/escape.js
var require_escape = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const metaCharsRegExp = /([()\][%!^"`<>&|;, *?])/g;
	function escapeCommand(arg) {
		arg = arg.replace(metaCharsRegExp, "^$1");
		return arg;
	}
	function escapeArgument(arg, doubleEscapeMetaChars) {
		arg = `${arg}`;
		arg = arg.replace(/(?=(\\+?)?)\1"/g, "$1$1\\\"");
		arg = arg.replace(/(?=(\\+?)?)\1$/, "$1$1");
		arg = `"${arg}"`;
		arg = arg.replace(metaCharsRegExp, "^$1");
		if (doubleEscapeMetaChars) arg = arg.replace(metaCharsRegExp, "^$1");
		return arg;
	}
	module.exports.command = escapeCommand;
	module.exports.argument = escapeArgument;
}));

//#endregion
//#region ../../node_modules/.pnpm/shebang-regex@3.0.0/node_modules/shebang-regex/index.js
var require_shebang_regex = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	module.exports = /^#!(.*)/;
}));

//#endregion
//#region ../../node_modules/.pnpm/shebang-command@2.0.0/node_modules/shebang-command/index.js
var require_shebang_command = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const shebangRegex = require_shebang_regex();
	module.exports = (string = "") => {
		const match = string.match(shebangRegex);
		if (!match) return null;
		const [path, argument] = match[0].replace(/#! ?/, "").split(" ");
		const binary = path.split("/").pop();
		if (binary === "env") return argument;
		return argument ? `${binary} ${argument}` : binary;
	};
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/util/readShebang.js
var require_readShebang = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const fs$1 = __require("fs");
	const shebangCommand = require_shebang_command();
	function readShebang(command) {
		const size = 150;
		const buffer = Buffer.alloc(size);
		let fd;
		try {
			fd = fs$1.openSync(command, "r");
			fs$1.readSync(fd, buffer, 0, size, 0);
			fs$1.closeSync(fd);
		} catch (e) {}
		return shebangCommand(buffer.toString());
	}
	module.exports = readShebang;
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/parse.js
var require_parse = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const path$1 = __require("path");
	const resolveCommand = require_resolveCommand();
	const escape = require_escape();
	const readShebang = require_readShebang();
	const isWin = process.platform === "win32";
	const isExecutableRegExp = /\.(?:com|exe)$/i;
	const isCmdShimRegExp = /node_modules[\\/].bin[\\/][^\\/]+\.cmd$/i;
	function detectShebang(parsed) {
		parsed.file = resolveCommand(parsed);
		const shebang = parsed.file && readShebang(parsed.file);
		if (shebang) {
			parsed.args.unshift(parsed.file);
			parsed.command = shebang;
			return resolveCommand(parsed);
		}
		return parsed.file;
	}
	function parseNonShell(parsed) {
		if (!isWin) return parsed;
		const commandFile = detectShebang(parsed);
		const needsShell = !isExecutableRegExp.test(commandFile);
		if (parsed.options.forceShell || needsShell) {
			const needsDoubleEscapeMetaChars = isCmdShimRegExp.test(commandFile);
			parsed.command = path$1.normalize(parsed.command);
			parsed.command = escape.command(parsed.command);
			parsed.args = parsed.args.map((arg) => escape.argument(arg, needsDoubleEscapeMetaChars));
			parsed.args = [
				"/d",
				"/s",
				"/c",
				`"${[parsed.command].concat(parsed.args).join(" ")}"`
			];
			parsed.command = process.env.comspec || "cmd.exe";
			parsed.options.windowsVerbatimArguments = true;
		}
		return parsed;
	}
	function parse(command, args, options) {
		if (args && !Array.isArray(args)) {
			options = args;
			args = null;
		}
		args = args ? args.slice(0) : [];
		options = Object.assign({}, options);
		const parsed = {
			command,
			args,
			options,
			file: void 0,
			original: {
				command,
				args
			}
		};
		return options.shell ? parsed : parseNonShell(parsed);
	}
	module.exports = parse;
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/lib/enoent.js
var require_enoent = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const isWin = process.platform === "win32";
	function notFoundError(original, syscall) {
		return Object.assign(/* @__PURE__ */ new Error(`${syscall} ${original.command} ENOENT`), {
			code: "ENOENT",
			errno: "ENOENT",
			syscall: `${syscall} ${original.command}`,
			path: original.command,
			spawnargs: original.args
		});
	}
	function hookChildProcess(cp, parsed) {
		if (!isWin) return;
		const originalEmit = cp.emit;
		cp.emit = function(name, arg1) {
			if (name === "exit") {
				const err = verifyENOENT(arg1, parsed);
				if (err) return originalEmit.call(cp, "error", err);
			}
			return originalEmit.apply(cp, arguments);
		};
	}
	function verifyENOENT(status, parsed) {
		if (isWin && status === 1 && !parsed.file) return notFoundError(parsed.original, "spawn");
		return null;
	}
	function verifyENOENTSync(status, parsed) {
		if (isWin && status === 1 && !parsed.file) return notFoundError(parsed.original, "spawnSync");
		return null;
	}
	module.exports = {
		hookChildProcess,
		verifyENOENT,
		verifyENOENTSync,
		notFoundError
	};
}));

//#endregion
//#region ../../node_modules/.pnpm/cross-spawn@7.0.6/node_modules/cross-spawn/index.js
var require_cross_spawn = /* @__PURE__ */ __commonJSMin(((exports, module) => {
	const cp = __require("child_process");
	const parse = require_parse();
	const enoent = require_enoent();
	function spawn(command, args, options) {
		const parsed = parse(command, args, options);
		const spawned = cp.spawn(parsed.command, parsed.args, parsed.options);
		enoent.hookChildProcess(spawned, parsed);
		return spawned;
	}
	function spawnSync(command, args, options) {
		const parsed = parse(command, args, options);
		const result = cp.spawnSync(parsed.command, parsed.args, parsed.options);
		result.error = result.error || enoent.verifyENOENTSync(result.status, parsed);
		return result;
	}
	module.exports = spawn;
	module.exports.spawn = spawn;
	module.exports.sync = spawnSync;
	module.exports._parse = parse;
	module.exports._enoent = enoent;
}));

//#endregion
//#region ../../node_modules/.pnpm/path-key@4.0.0/node_modules/path-key/index.js
var import_cross_spawn = /* @__PURE__ */ __toESM(require_cross_spawn(), 1);
function pathKey(options = {}) {
	const { env = process.env, platform = process.platform } = options;
	if (platform !== "win32") return "PATH";
	return Object.keys(env).reverse().find((key) => key.toUpperCase() === "PATH") || "Path";
}

//#endregion
//#region ../../node_modules/.pnpm/unicorn-magic@0.3.0/node_modules/unicorn-magic/node.js
const execFileOriginal = promisify(execFile);
function toPath(urlOrPath) {
	return urlOrPath instanceof URL ? fileURLToPath(urlOrPath) : urlOrPath;
}
function traversePathUp(startPath) {
	return { *[Symbol.iterator]() {
		let currentPath = path.resolve(toPath(startPath));
		let previousPath;
		while (previousPath !== currentPath) {
			yield currentPath;
			previousPath = currentPath;
			currentPath = path.resolve(currentPath, "..");
		}
	} };
}

//#endregion
//#region ../../node_modules/.pnpm/npm-run-path@6.0.0/node_modules/npm-run-path/index.js
const npmRunPath = ({ cwd = process$1.cwd(), path: pathOption = process$1.env[pathKey()], preferLocal = true, execPath = process$1.execPath, addExecPath = true } = {}) => {
	const cwdPath = path.resolve(toPath(cwd));
	const result = [];
	const pathParts = pathOption.split(path.delimiter);
	if (preferLocal) applyPreferLocal(result, pathParts, cwdPath);
	if (addExecPath) applyExecPath(result, pathParts, execPath, cwdPath);
	return pathOption === "" || pathOption === path.delimiter ? `${result.join(path.delimiter)}${pathOption}` : [...result, pathOption].join(path.delimiter);
};
const applyPreferLocal = (result, pathParts, cwdPath) => {
	for (const directory of traversePathUp(cwdPath)) {
		const pathPart = path.join(directory, "node_modules/.bin");
		if (!pathParts.includes(pathPart)) result.push(pathPart);
	}
};
const applyExecPath = (result, pathParts, execPath, cwdPath) => {
	const pathPart = path.resolve(cwdPath, toPath(execPath), "..");
	if (!pathParts.includes(pathPart)) result.push(pathPart);
};
const npmRunPathEnv = ({ env = process$1.env, ...options } = {}) => {
	env = { ...env };
	const pathName = pathKey({ env });
	options.path = env[pathName];
	env[pathName] = npmRunPath(options);
	return env;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/final-error.js
const getFinalError = (originalError, message, isSync) => {
	return new (isSync ? ExecaSyncError : ExecaError)(message, originalError instanceof DiscardedError ? {} : { cause: originalError });
};
var DiscardedError = class extends Error {};
const setErrorName = (ErrorClass, value) => {
	Object.defineProperty(ErrorClass.prototype, "name", {
		value,
		writable: true,
		enumerable: false,
		configurable: true
	});
	Object.defineProperty(ErrorClass.prototype, execaErrorSymbol, {
		value: true,
		writable: false,
		enumerable: false,
		configurable: false
	});
};
const isExecaError = (error) => isErrorInstance(error) && execaErrorSymbol in error;
const execaErrorSymbol = Symbol("isExecaError");
const isErrorInstance = (value) => Object.prototype.toString.call(value) === "[object Error]";
var ExecaError = class extends Error {};
setErrorName(ExecaError, ExecaError.name);
var ExecaSyncError = class extends Error {};
setErrorName(ExecaSyncError, ExecaSyncError.name);

//#endregion
//#region ../../node_modules/.pnpm/human-signals@8.0.1/node_modules/human-signals/build/src/realtime.js
const getRealtimeSignals = () => {
	const length = 64 - SIGRTMIN + 1;
	return Array.from({ length }, getRealtimeSignal);
};
const getRealtimeSignal = (value, index) => ({
	name: `SIGRT${index + 1}`,
	number: SIGRTMIN + index,
	action: "terminate",
	description: "Application-specific signal (realtime)",
	standard: "posix"
});
const SIGRTMIN = 34;
const SIGRTMAX = 64;

//#endregion
//#region ../../node_modules/.pnpm/human-signals@8.0.1/node_modules/human-signals/build/src/core.js
const SIGNALS = [
	{
		name: "SIGHUP",
		number: 1,
		action: "terminate",
		description: "Terminal closed",
		standard: "posix"
	},
	{
		name: "SIGINT",
		number: 2,
		action: "terminate",
		description: "User interruption with CTRL-C",
		standard: "ansi"
	},
	{
		name: "SIGQUIT",
		number: 3,
		action: "core",
		description: "User interruption with CTRL-\\",
		standard: "posix"
	},
	{
		name: "SIGILL",
		number: 4,
		action: "core",
		description: "Invalid machine instruction",
		standard: "ansi"
	},
	{
		name: "SIGTRAP",
		number: 5,
		action: "core",
		description: "Debugger breakpoint",
		standard: "posix"
	},
	{
		name: "SIGABRT",
		number: 6,
		action: "core",
		description: "Aborted",
		standard: "ansi"
	},
	{
		name: "SIGIOT",
		number: 6,
		action: "core",
		description: "Aborted",
		standard: "bsd"
	},
	{
		name: "SIGBUS",
		number: 7,
		action: "core",
		description: "Bus error due to misaligned, non-existing address or paging error",
		standard: "bsd"
	},
	{
		name: "SIGEMT",
		number: 7,
		action: "terminate",
		description: "Command should be emulated but is not implemented",
		standard: "other"
	},
	{
		name: "SIGFPE",
		number: 8,
		action: "core",
		description: "Floating point arithmetic error",
		standard: "ansi"
	},
	{
		name: "SIGKILL",
		number: 9,
		action: "terminate",
		description: "Forced termination",
		standard: "posix",
		forced: true
	},
	{
		name: "SIGUSR1",
		number: 10,
		action: "terminate",
		description: "Application-specific signal",
		standard: "posix"
	},
	{
		name: "SIGSEGV",
		number: 11,
		action: "core",
		description: "Segmentation fault",
		standard: "ansi"
	},
	{
		name: "SIGUSR2",
		number: 12,
		action: "terminate",
		description: "Application-specific signal",
		standard: "posix"
	},
	{
		name: "SIGPIPE",
		number: 13,
		action: "terminate",
		description: "Broken pipe or socket",
		standard: "posix"
	},
	{
		name: "SIGALRM",
		number: 14,
		action: "terminate",
		description: "Timeout or timer",
		standard: "posix"
	},
	{
		name: "SIGTERM",
		number: 15,
		action: "terminate",
		description: "Termination",
		standard: "ansi"
	},
	{
		name: "SIGSTKFLT",
		number: 16,
		action: "terminate",
		description: "Stack is empty or overflowed",
		standard: "other"
	},
	{
		name: "SIGCHLD",
		number: 17,
		action: "ignore",
		description: "Child process terminated, paused or unpaused",
		standard: "posix"
	},
	{
		name: "SIGCLD",
		number: 17,
		action: "ignore",
		description: "Child process terminated, paused or unpaused",
		standard: "other"
	},
	{
		name: "SIGCONT",
		number: 18,
		action: "unpause",
		description: "Unpaused",
		standard: "posix",
		forced: true
	},
	{
		name: "SIGSTOP",
		number: 19,
		action: "pause",
		description: "Paused",
		standard: "posix",
		forced: true
	},
	{
		name: "SIGTSTP",
		number: 20,
		action: "pause",
		description: "Paused using CTRL-Z or \"suspend\"",
		standard: "posix"
	},
	{
		name: "SIGTTIN",
		number: 21,
		action: "pause",
		description: "Background process cannot read terminal input",
		standard: "posix"
	},
	{
		name: "SIGBREAK",
		number: 21,
		action: "terminate",
		description: "User interruption with CTRL-BREAK",
		standard: "other"
	},
	{
		name: "SIGTTOU",
		number: 22,
		action: "pause",
		description: "Background process cannot write to terminal output",
		standard: "posix"
	},
	{
		name: "SIGURG",
		number: 23,
		action: "ignore",
		description: "Socket received out-of-band data",
		standard: "bsd"
	},
	{
		name: "SIGXCPU",
		number: 24,
		action: "core",
		description: "Process timed out",
		standard: "bsd"
	},
	{
		name: "SIGXFSZ",
		number: 25,
		action: "core",
		description: "File too big",
		standard: "bsd"
	},
	{
		name: "SIGVTALRM",
		number: 26,
		action: "terminate",
		description: "Timeout or timer",
		standard: "bsd"
	},
	{
		name: "SIGPROF",
		number: 27,
		action: "terminate",
		description: "Timeout or timer",
		standard: "bsd"
	},
	{
		name: "SIGWINCH",
		number: 28,
		action: "ignore",
		description: "Terminal window size changed",
		standard: "bsd"
	},
	{
		name: "SIGIO",
		number: 29,
		action: "terminate",
		description: "I/O is available",
		standard: "other"
	},
	{
		name: "SIGPOLL",
		number: 29,
		action: "terminate",
		description: "Watched event",
		standard: "other"
	},
	{
		name: "SIGINFO",
		number: 29,
		action: "ignore",
		description: "Request for process information",
		standard: "other"
	},
	{
		name: "SIGPWR",
		number: 30,
		action: "terminate",
		description: "Device running out of power",
		standard: "systemv"
	},
	{
		name: "SIGSYS",
		number: 31,
		action: "core",
		description: "Invalid system call",
		standard: "other"
	},
	{
		name: "SIGUNUSED",
		number: 31,
		action: "terminate",
		description: "Invalid system call",
		standard: "other"
	}
];

//#endregion
//#region ../../node_modules/.pnpm/human-signals@8.0.1/node_modules/human-signals/build/src/signals.js
const getSignals = () => {
	const realtimeSignals = getRealtimeSignals();
	return [...SIGNALS, ...realtimeSignals].map(normalizeSignal$1);
};
const normalizeSignal$1 = ({ name, number: defaultNumber, description, action, forced = false, standard }) => {
	const { signals: { [name]: constantSignal } } = constants$1;
	const supported = constantSignal !== void 0;
	return {
		name,
		number: supported ? constantSignal : defaultNumber,
		description,
		supported,
		action,
		forced,
		standard
	};
};

//#endregion
//#region ../../node_modules/.pnpm/human-signals@8.0.1/node_modules/human-signals/build/src/main.js
const getSignalsByName = () => {
	const signals = getSignals();
	return Object.fromEntries(signals.map(getSignalByName));
};
const getSignalByName = ({ name, number, description, supported, action, forced, standard }) => [name, {
	name,
	number,
	description,
	supported,
	action,
	forced,
	standard
}];
const signalsByName = getSignalsByName();
const getSignalsByNumber = () => {
	const signals = getSignals();
	const length = 64 + 1;
	const signalsA = Array.from({ length }, (value, number) => getSignalByNumber(number, signals));
	return Object.assign({}, ...signalsA);
};
const getSignalByNumber = (number, signals) => {
	const signal = findSignalByNumber(number, signals);
	if (signal === void 0) return {};
	const { name, description, supported, action, forced, standard } = signal;
	return { [number]: {
		name,
		number,
		description,
		supported,
		action,
		forced,
		standard
	} };
};
const findSignalByNumber = (number, signals) => {
	const signal = signals.find(({ name }) => constants$1.signals[name] === number);
	if (signal !== void 0) return signal;
	return signals.find((signalA) => signalA.number === number);
};
const signalsByNumber = getSignalsByNumber();

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/signal.js
const normalizeKillSignal = (killSignal) => {
	const optionName = "option `killSignal`";
	if (killSignal === 0) throw new TypeError(`Invalid ${optionName}: 0 cannot be used.`);
	return normalizeSignal(killSignal, optionName);
};
const normalizeSignalArgument = (signal) => signal === 0 ? signal : normalizeSignal(signal, "`subprocess.kill()`'s argument");
const normalizeSignal = (signalNameOrInteger, optionName) => {
	if (Number.isInteger(signalNameOrInteger)) return normalizeSignalInteger(signalNameOrInteger, optionName);
	if (typeof signalNameOrInteger === "string") return normalizeSignalName(signalNameOrInteger, optionName);
	throw new TypeError(`Invalid ${optionName} ${String(signalNameOrInteger)}: it must be a string or an integer.\n${getAvailableSignals()}`);
};
const normalizeSignalInteger = (signalInteger, optionName) => {
	if (signalsIntegerToName.has(signalInteger)) return signalsIntegerToName.get(signalInteger);
	throw new TypeError(`Invalid ${optionName} ${signalInteger}: this signal integer does not exist.\n${getAvailableSignals()}`);
};
const getSignalsIntegerToName = () => new Map(Object.entries(constants$1.signals).reverse().map(([signalName, signalInteger]) => [signalInteger, signalName]));
const signalsIntegerToName = getSignalsIntegerToName();
const normalizeSignalName = (signalName, optionName) => {
	if (signalName in constants$1.signals) return signalName;
	if (signalName.toUpperCase() in constants$1.signals) throw new TypeError(`Invalid ${optionName} '${signalName}': please rename it to '${signalName.toUpperCase()}'.`);
	throw new TypeError(`Invalid ${optionName} '${signalName}': this signal name does not exist.\n${getAvailableSignals()}`);
};
const getAvailableSignals = () => `Available signal names: ${getAvailableSignalNames()}.
Available signal numbers: ${getAvailableSignalIntegers()}.`;
const getAvailableSignalNames = () => Object.keys(constants$1.signals).sort().map((signalName) => `'${signalName}'`).join(", ");
const getAvailableSignalIntegers = () => [...new Set(Object.values(constants$1.signals).sort((signalInteger, signalIntegerTwo) => signalInteger - signalIntegerTwo))].join(", ");
const getSignalDescription = (signal) => signalsByName[signal].description;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/kill.js
const normalizeForceKillAfterDelay = (forceKillAfterDelay) => {
	if (forceKillAfterDelay === false) return forceKillAfterDelay;
	if (forceKillAfterDelay === true) return DEFAULT_FORCE_KILL_TIMEOUT;
	if (!Number.isFinite(forceKillAfterDelay) || forceKillAfterDelay < 0) throw new TypeError(`Expected the \`forceKillAfterDelay\` option to be a non-negative integer, got \`${forceKillAfterDelay}\` (${typeof forceKillAfterDelay})`);
	return forceKillAfterDelay;
};
const DEFAULT_FORCE_KILL_TIMEOUT = 1e3 * 5;
const subprocessKill = ({ kill, options: { forceKillAfterDelay, killSignal }, onInternalError, context, controller }, signalOrError, errorArgument) => {
	const { signal, error } = parseKillArguments(signalOrError, errorArgument, killSignal);
	emitKillError(error, onInternalError);
	const killResult = kill(signal);
	setKillTimeout({
		kill,
		signal,
		forceKillAfterDelay,
		killSignal,
		killResult,
		context,
		controller
	});
	return killResult;
};
const parseKillArguments = (signalOrError, errorArgument, killSignal) => {
	const [signal = killSignal, error] = isErrorInstance(signalOrError) ? [void 0, signalOrError] : [signalOrError, errorArgument];
	if (typeof signal !== "string" && !Number.isInteger(signal)) throw new TypeError(`The first argument must be an error instance or a signal name string/integer: ${String(signal)}`);
	if (error !== void 0 && !isErrorInstance(error)) throw new TypeError(`The second argument is optional. If specified, it must be an error instance: ${error}`);
	return {
		signal: normalizeSignalArgument(signal),
		error
	};
};
const emitKillError = (error, onInternalError) => {
	if (error !== void 0) onInternalError.reject(error);
};
const setKillTimeout = async ({ kill, signal, forceKillAfterDelay, killSignal, killResult, context, controller }) => {
	if (signal === killSignal && killResult) killOnTimeout({
		kill,
		forceKillAfterDelay,
		context,
		controllerSignal: controller.signal
	});
};
const killOnTimeout = async ({ kill, forceKillAfterDelay, context, controllerSignal }) => {
	if (forceKillAfterDelay === false) return;
	try {
		await setTimeout(forceKillAfterDelay, void 0, { signal: controllerSignal });
		if (kill("SIGKILL")) context.isForcefullyTerminated ??= true;
	} catch {}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/utils/abort-signal.js
const onAbortedSignal = async (mainSignal, stopSignal) => {
	if (!mainSignal.aborted) await once(mainSignal, "abort", { signal: stopSignal });
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/cancel.js
const validateCancelSignal = ({ cancelSignal }) => {
	if (cancelSignal !== void 0 && Object.prototype.toString.call(cancelSignal) !== "[object AbortSignal]") throw new Error(`The \`cancelSignal\` option must be an AbortSignal: ${String(cancelSignal)}`);
};
const throwOnCancel = ({ subprocess, cancelSignal, gracefulCancel, context, controller }) => cancelSignal === void 0 || gracefulCancel ? [] : [terminateOnCancel(subprocess, cancelSignal, context, controller)];
const terminateOnCancel = async (subprocess, cancelSignal, context, { signal }) => {
	await onAbortedSignal(cancelSignal, signal);
	context.terminationReason ??= "cancel";
	subprocess.kill();
	throw cancelSignal.reason;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/validation.js
const validateIpcMethod = ({ methodName, isSubprocess, ipc, isConnected }) => {
	validateIpcOption(methodName, isSubprocess, ipc);
	validateConnection(methodName, isSubprocess, isConnected);
};
const validateIpcOption = (methodName, isSubprocess, ipc) => {
	if (!ipc) throw new Error(`${getMethodName(methodName, isSubprocess)} can only be used if the \`ipc\` option is \`true\`.`);
};
const validateConnection = (methodName, isSubprocess, isConnected) => {
	if (!isConnected) throw new Error(`${getMethodName(methodName, isSubprocess)} cannot be used: the ${getOtherProcessName(isSubprocess)} has already exited or disconnected.`);
};
const throwOnEarlyDisconnect = (isSubprocess) => {
	throw new Error(`${getMethodName("getOneMessage", isSubprocess)} could not complete: the ${getOtherProcessName(isSubprocess)} exited or disconnected.`);
};
const throwOnStrictDeadlockError = (isSubprocess) => {
	throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} is sending a message too, instead of listening to incoming messages.
This can be fixed by both sending a message and listening to incoming messages at the same time:

const [receivedMessage] = await Promise.all([
	${getMethodName("getOneMessage", isSubprocess)},
	${getMethodName("sendMessage", isSubprocess, "message, {strict: true}")},
]);`);
};
const getStrictResponseError = (error, isSubprocess) => new Error(`${getMethodName("sendMessage", isSubprocess)} failed when sending an acknowledgment response to the ${getOtherProcessName(isSubprocess)}.`, { cause: error });
const throwOnMissingStrict = (isSubprocess) => {
	throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} is not listening to incoming messages.`);
};
const throwOnStrictDisconnect = (isSubprocess) => {
	throw new Error(`${getMethodName("sendMessage", isSubprocess)} failed: the ${getOtherProcessName(isSubprocess)} exited without listening to incoming messages.`);
};
const getAbortDisconnectError = () => /* @__PURE__ */ new Error(`\`cancelSignal\` aborted: the ${getOtherProcessName(true)} disconnected.`);
const throwOnMissingParent = () => {
	throw new Error("`getCancelSignal()` cannot be used without setting the `cancelSignal` subprocess option.");
};
const handleEpipeError = ({ error, methodName, isSubprocess }) => {
	if (error.code === "EPIPE") throw new Error(`${getMethodName(methodName, isSubprocess)} cannot be used: the ${getOtherProcessName(isSubprocess)} is disconnecting.`, { cause: error });
};
const handleSerializationError = ({ error, methodName, isSubprocess, message }) => {
	if (isSerializationError(error)) throw new Error(`${getMethodName(methodName, isSubprocess)}'s argument type is invalid: the message cannot be serialized: ${String(message)}.`, { cause: error });
};
const isSerializationError = ({ code, message }) => SERIALIZATION_ERROR_CODES.has(code) || SERIALIZATION_ERROR_MESSAGES.some((serializationErrorMessage) => message.includes(serializationErrorMessage));
const SERIALIZATION_ERROR_CODES = /* @__PURE__ */ new Set(["ERR_MISSING_ARGS", "ERR_INVALID_ARG_TYPE"]);
const SERIALIZATION_ERROR_MESSAGES = [
	"could not be cloned",
	"circular structure",
	"call stack size exceeded"
];
const getMethodName = (methodName, isSubprocess, parameters = "") => methodName === "cancelSignal" ? "`cancelSignal`'s `controller.abort()`" : `${getNamespaceName(isSubprocess)}${methodName}(${parameters})`;
const getNamespaceName = (isSubprocess) => isSubprocess ? "" : "subprocess.";
const getOtherProcessName = (isSubprocess) => isSubprocess ? "parent process" : "subprocess";
const disconnect = (anyProcess) => {
	if (anyProcess.connected) anyProcess.disconnect();
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/utils/deferred.js
const createDeferred = () => {
	const methods = {};
	const promise = new Promise((resolve, reject) => {
		Object.assign(methods, {
			resolve,
			reject
		});
	});
	return Object.assign(promise, methods);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/fd-options.js
const getToStream = (destination, to = "stdin") => {
	const isWritable = true;
	const { options, fileDescriptors } = SUBPROCESS_OPTIONS.get(destination);
	const fdNumber = getFdNumber(fileDescriptors, to, isWritable);
	const destinationStream = destination.stdio[fdNumber];
	if (destinationStream === null) throw new TypeError(getInvalidStdioOptionMessage(fdNumber, to, options, isWritable));
	return destinationStream;
};
const getFromStream = (source, from = "stdout") => {
	const isWritable = false;
	const { options, fileDescriptors } = SUBPROCESS_OPTIONS.get(source);
	const fdNumber = getFdNumber(fileDescriptors, from, isWritable);
	const sourceStream = fdNumber === "all" ? source.all : source.stdio[fdNumber];
	if (sourceStream === null || sourceStream === void 0) throw new TypeError(getInvalidStdioOptionMessage(fdNumber, from, options, isWritable));
	return sourceStream;
};
const SUBPROCESS_OPTIONS = /* @__PURE__ */ new WeakMap();
const getFdNumber = (fileDescriptors, fdName, isWritable) => {
	const fdNumber = parseFdNumber(fdName, isWritable);
	validateFdNumber(fdNumber, fdName, isWritable, fileDescriptors);
	return fdNumber;
};
const parseFdNumber = (fdName, isWritable) => {
	const fdNumber = parseFd(fdName);
	if (fdNumber !== void 0) return fdNumber;
	const { validOptions, defaultValue } = isWritable ? {
		validOptions: "\"stdin\"",
		defaultValue: "stdin"
	} : {
		validOptions: "\"stdout\", \"stderr\", \"all\"",
		defaultValue: "stdout"
	};
	throw new TypeError(`"${getOptionName(isWritable)}" must not be "${fdName}".
It must be ${validOptions} or "fd3", "fd4" (and so on).
It is optional and defaults to "${defaultValue}".`);
};
const validateFdNumber = (fdNumber, fdName, isWritable, fileDescriptors) => {
	const fileDescriptor = fileDescriptors[getUsedDescriptor(fdNumber)];
	if (fileDescriptor === void 0) throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. That file descriptor does not exist.
Please set the "stdio" option to ensure that file descriptor exists.`);
	if (fileDescriptor.direction === "input" && !isWritable) throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. It must be a readable stream, not writable.`);
	if (fileDescriptor.direction !== "input" && isWritable) throw new TypeError(`"${getOptionName(isWritable)}" must not be ${fdName}. It must be a writable stream, not readable.`);
};
const getInvalidStdioOptionMessage = (fdNumber, fdName, options, isWritable) => {
	if (fdNumber === "all" && !options.all) return "The \"all\" option must be true to use \"from: 'all'\".";
	const { optionName, optionValue } = getInvalidStdioOption(fdNumber, options);
	return `The "${optionName}: ${serializeOptionValue(optionValue)}" option is incompatible with using "${getOptionName(isWritable)}: ${serializeOptionValue(fdName)}".
Please set this option with "pipe" instead.`;
};
const getInvalidStdioOption = (fdNumber, { stdin, stdout, stderr, stdio }) => {
	const usedDescriptor = getUsedDescriptor(fdNumber);
	if (usedDescriptor === 0 && stdin !== void 0) return {
		optionName: "stdin",
		optionValue: stdin
	};
	if (usedDescriptor === 1 && stdout !== void 0) return {
		optionName: "stdout",
		optionValue: stdout
	};
	if (usedDescriptor === 2 && stderr !== void 0) return {
		optionName: "stderr",
		optionValue: stderr
	};
	return {
		optionName: `stdio[${usedDescriptor}]`,
		optionValue: stdio[usedDescriptor]
	};
};
const getUsedDescriptor = (fdNumber) => fdNumber === "all" ? 1 : fdNumber;
const getOptionName = (isWritable) => isWritable ? "to" : "from";
const serializeOptionValue = (value) => {
	if (typeof value === "string") return `'${value}'`;
	return typeof value === "number" ? `${value}` : "Stream";
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/utils/max-listeners.js
const incrementMaxListeners = (eventEmitter, maxListenersIncrement, signal) => {
	const maxListeners = eventEmitter.getMaxListeners();
	if (maxListeners === 0 || maxListeners === Number.POSITIVE_INFINITY) return;
	eventEmitter.setMaxListeners(maxListeners + maxListenersIncrement);
	addAbortListener(signal, () => {
		eventEmitter.setMaxListeners(eventEmitter.getMaxListeners() - maxListenersIncrement);
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/reference.js
const addReference = (channel, reference) => {
	if (reference) addReferenceCount(channel);
};
const addReferenceCount = (channel) => {
	channel.refCounted();
};
const removeReference = (channel, reference) => {
	if (reference) removeReferenceCount(channel);
};
const removeReferenceCount = (channel) => {
	channel.unrefCounted();
};
const undoAddedReferences = (channel, isSubprocess) => {
	if (isSubprocess) {
		removeReferenceCount(channel);
		removeReferenceCount(channel);
	}
};
const redoAddedReferences = (channel, isSubprocess) => {
	if (isSubprocess) {
		addReferenceCount(channel);
		addReferenceCount(channel);
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/incoming.js
const onMessage = async ({ anyProcess, channel, isSubprocess, ipcEmitter }, wrappedMessage) => {
	if (handleStrictResponse(wrappedMessage) || handleAbort(wrappedMessage)) return;
	if (!INCOMING_MESSAGES.has(anyProcess)) INCOMING_MESSAGES.set(anyProcess, []);
	const incomingMessages = INCOMING_MESSAGES.get(anyProcess);
	incomingMessages.push(wrappedMessage);
	if (incomingMessages.length > 1) return;
	while (incomingMessages.length > 0) {
		await waitForOutgoingMessages(anyProcess, ipcEmitter, wrappedMessage);
		await scheduler.yield();
		const message = await handleStrictRequest({
			wrappedMessage: incomingMessages[0],
			anyProcess,
			channel,
			isSubprocess,
			ipcEmitter
		});
		incomingMessages.shift();
		ipcEmitter.emit("message", message);
		ipcEmitter.emit("message:done");
	}
};
const onDisconnect = async ({ anyProcess, channel, isSubprocess, ipcEmitter, boundOnMessage }) => {
	abortOnDisconnect();
	const incomingMessages = INCOMING_MESSAGES.get(anyProcess);
	while (incomingMessages?.length > 0) await once(ipcEmitter, "message:done");
	anyProcess.removeListener("message", boundOnMessage);
	redoAddedReferences(channel, isSubprocess);
	ipcEmitter.connected = false;
	ipcEmitter.emit("disconnect");
};
const INCOMING_MESSAGES = /* @__PURE__ */ new WeakMap();

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/forward.js
const getIpcEmitter = (anyProcess, channel, isSubprocess) => {
	if (IPC_EMITTERS.has(anyProcess)) return IPC_EMITTERS.get(anyProcess);
	const ipcEmitter = new EventEmitter();
	ipcEmitter.connected = true;
	IPC_EMITTERS.set(anyProcess, ipcEmitter);
	forwardEvents({
		ipcEmitter,
		anyProcess,
		channel,
		isSubprocess
	});
	return ipcEmitter;
};
const IPC_EMITTERS = /* @__PURE__ */ new WeakMap();
const forwardEvents = ({ ipcEmitter, anyProcess, channel, isSubprocess }) => {
	const boundOnMessage = onMessage.bind(void 0, {
		anyProcess,
		channel,
		isSubprocess,
		ipcEmitter
	});
	anyProcess.on("message", boundOnMessage);
	anyProcess.once("disconnect", onDisconnect.bind(void 0, {
		anyProcess,
		channel,
		isSubprocess,
		ipcEmitter,
		boundOnMessage
	}));
	undoAddedReferences(channel, isSubprocess);
};
const isConnected = (anyProcess) => {
	const ipcEmitter = IPC_EMITTERS.get(anyProcess);
	return ipcEmitter === void 0 ? anyProcess.channel !== null : ipcEmitter.connected;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/strict.js
const handleSendStrict = ({ anyProcess, channel, isSubprocess, message, strict }) => {
	if (!strict) return message;
	const hasListeners = hasMessageListeners(anyProcess, getIpcEmitter(anyProcess, channel, isSubprocess));
	return {
		id: count++,
		type: REQUEST_TYPE,
		message,
		hasListeners
	};
};
let count = 0n;
const validateStrictDeadlock = (outgoingMessages, wrappedMessage) => {
	if (wrappedMessage?.type !== REQUEST_TYPE || wrappedMessage.hasListeners) return;
	for (const { id } of outgoingMessages) if (id !== void 0) STRICT_RESPONSES[id].resolve({
		isDeadlock: true,
		hasListeners: false
	});
};
const handleStrictRequest = async ({ wrappedMessage, anyProcess, channel, isSubprocess, ipcEmitter }) => {
	if (wrappedMessage?.type !== REQUEST_TYPE || !anyProcess.connected) return wrappedMessage;
	const { id, message } = wrappedMessage;
	const response = {
		id,
		type: RESPONSE_TYPE,
		message: hasMessageListeners(anyProcess, ipcEmitter)
	};
	try {
		await sendMessage$1({
			anyProcess,
			channel,
			isSubprocess,
			ipc: true
		}, response);
	} catch (error) {
		ipcEmitter.emit("strict:error", error);
	}
	return message;
};
const handleStrictResponse = (wrappedMessage) => {
	if (wrappedMessage?.type !== RESPONSE_TYPE) return false;
	const { id, message: hasListeners } = wrappedMessage;
	STRICT_RESPONSES[id]?.resolve({
		isDeadlock: false,
		hasListeners
	});
	return true;
};
const waitForStrictResponse = async (wrappedMessage, anyProcess, isSubprocess) => {
	if (wrappedMessage?.type !== REQUEST_TYPE) return;
	const deferred = createDeferred();
	STRICT_RESPONSES[wrappedMessage.id] = deferred;
	const controller = new AbortController();
	try {
		const { isDeadlock, hasListeners } = await Promise.race([deferred, throwOnDisconnect$1(anyProcess, isSubprocess, controller)]);
		if (isDeadlock) throwOnStrictDeadlockError(isSubprocess);
		if (!hasListeners) throwOnMissingStrict(isSubprocess);
	} finally {
		controller.abort();
		delete STRICT_RESPONSES[wrappedMessage.id];
	}
};
const STRICT_RESPONSES = {};
const throwOnDisconnect$1 = async (anyProcess, isSubprocess, { signal }) => {
	incrementMaxListeners(anyProcess, 1, signal);
	await once(anyProcess, "disconnect", { signal });
	throwOnStrictDisconnect(isSubprocess);
};
const REQUEST_TYPE = "execa:ipc:request";
const RESPONSE_TYPE = "execa:ipc:response";

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/outgoing.js
const startSendMessage = (anyProcess, wrappedMessage, strict) => {
	if (!OUTGOING_MESSAGES.has(anyProcess)) OUTGOING_MESSAGES.set(anyProcess, /* @__PURE__ */ new Set());
	const outgoingMessages = OUTGOING_MESSAGES.get(anyProcess);
	const outgoingMessage = {
		onMessageSent: createDeferred(),
		id: strict ? wrappedMessage.id : void 0
	};
	outgoingMessages.add(outgoingMessage);
	return {
		outgoingMessages,
		outgoingMessage
	};
};
const endSendMessage = ({ outgoingMessages, outgoingMessage }) => {
	outgoingMessages.delete(outgoingMessage);
	outgoingMessage.onMessageSent.resolve();
};
const waitForOutgoingMessages = async (anyProcess, ipcEmitter, wrappedMessage) => {
	while (!hasMessageListeners(anyProcess, ipcEmitter) && OUTGOING_MESSAGES.get(anyProcess)?.size > 0) {
		const outgoingMessages = [...OUTGOING_MESSAGES.get(anyProcess)];
		validateStrictDeadlock(outgoingMessages, wrappedMessage);
		await Promise.all(outgoingMessages.map(({ onMessageSent }) => onMessageSent));
	}
};
const OUTGOING_MESSAGES = /* @__PURE__ */ new WeakMap();
const hasMessageListeners = (anyProcess, ipcEmitter) => ipcEmitter.listenerCount("message") > getMinListenerCount(anyProcess);
const getMinListenerCount = (anyProcess) => SUBPROCESS_OPTIONS.has(anyProcess) && !getFdSpecificValue(SUBPROCESS_OPTIONS.get(anyProcess).options.buffer, "ipc") ? 1 : 0;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/send.js
const sendMessage$1 = ({ anyProcess, channel, isSubprocess, ipc }, message, { strict = false } = {}) => {
	const methodName = "sendMessage";
	validateIpcMethod({
		methodName,
		isSubprocess,
		ipc,
		isConnected: anyProcess.connected
	});
	return sendMessageAsync({
		anyProcess,
		channel,
		methodName,
		isSubprocess,
		message,
		strict
	});
};
const sendMessageAsync = async ({ anyProcess, channel, methodName, isSubprocess, message, strict }) => {
	const wrappedMessage = handleSendStrict({
		anyProcess,
		channel,
		isSubprocess,
		message,
		strict
	});
	const outgoingMessagesState = startSendMessage(anyProcess, wrappedMessage, strict);
	try {
		await sendOneMessage({
			anyProcess,
			methodName,
			isSubprocess,
			wrappedMessage,
			message
		});
	} catch (error) {
		disconnect(anyProcess);
		throw error;
	} finally {
		endSendMessage(outgoingMessagesState);
	}
};
const sendOneMessage = async ({ anyProcess, methodName, isSubprocess, wrappedMessage, message }) => {
	const sendMethod = getSendMethod(anyProcess);
	try {
		await Promise.all([waitForStrictResponse(wrappedMessage, anyProcess, isSubprocess), sendMethod(wrappedMessage)]);
	} catch (error) {
		handleEpipeError({
			error,
			methodName,
			isSubprocess
		});
		handleSerializationError({
			error,
			methodName,
			isSubprocess,
			message
		});
		throw error;
	}
};
const getSendMethod = (anyProcess) => {
	if (PROCESS_SEND_METHODS.has(anyProcess)) return PROCESS_SEND_METHODS.get(anyProcess);
	const sendMethod = promisify(anyProcess.send.bind(anyProcess));
	PROCESS_SEND_METHODS.set(anyProcess, sendMethod);
	return sendMethod;
};
const PROCESS_SEND_METHODS = /* @__PURE__ */ new WeakMap();

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/graceful.js
const sendAbort = (subprocess, message) => {
	const methodName = "cancelSignal";
	validateConnection(methodName, false, subprocess.connected);
	return sendOneMessage({
		anyProcess: subprocess,
		methodName,
		isSubprocess: false,
		wrappedMessage: {
			type: GRACEFUL_CANCEL_TYPE,
			message
		},
		message
	});
};
const getCancelSignal$1 = async ({ anyProcess, channel, isSubprocess, ipc }) => {
	await startIpc({
		anyProcess,
		channel,
		isSubprocess,
		ipc
	});
	return cancelController.signal;
};
const startIpc = async ({ anyProcess, channel, isSubprocess, ipc }) => {
	if (cancelListening) return;
	cancelListening = true;
	if (!ipc) {
		throwOnMissingParent();
		return;
	}
	if (channel === null) {
		abortOnDisconnect();
		return;
	}
	getIpcEmitter(anyProcess, channel, isSubprocess);
	await scheduler.yield();
};
let cancelListening = false;
const handleAbort = (wrappedMessage) => {
	if (wrappedMessage?.type !== GRACEFUL_CANCEL_TYPE) return false;
	cancelController.abort(wrappedMessage.message);
	return true;
};
const GRACEFUL_CANCEL_TYPE = "execa:ipc:cancel";
const abortOnDisconnect = () => {
	cancelController.abort(getAbortDisconnectError());
};
const cancelController = new AbortController();

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/graceful.js
const validateGracefulCancel = ({ gracefulCancel, cancelSignal, ipc, serialization }) => {
	if (!gracefulCancel) return;
	if (cancelSignal === void 0) throw new Error("The `cancelSignal` option must be defined when setting the `gracefulCancel` option.");
	if (!ipc) throw new Error("The `ipc` option cannot be false when setting the `gracefulCancel` option.");
	if (serialization === "json") throw new Error("The `serialization` option cannot be 'json' when setting the `gracefulCancel` option.");
};
const throwOnGracefulCancel = ({ subprocess, cancelSignal, gracefulCancel, forceKillAfterDelay, context, controller }) => gracefulCancel ? [sendOnAbort({
	subprocess,
	cancelSignal,
	forceKillAfterDelay,
	context,
	controller
})] : [];
const sendOnAbort = async ({ subprocess, cancelSignal, forceKillAfterDelay, context, controller: { signal } }) => {
	await onAbortedSignal(cancelSignal, signal);
	await sendAbort(subprocess, getReason(cancelSignal));
	killOnTimeout({
		kill: subprocess.kill,
		forceKillAfterDelay,
		context,
		controllerSignal: signal
	});
	context.terminationReason ??= "gracefulCancel";
	throw cancelSignal.reason;
};
const getReason = ({ reason }) => {
	if (!(reason instanceof DOMException)) return reason;
	const error = new Error(reason.message);
	Object.defineProperty(error, "stack", {
		value: reason.stack,
		enumerable: false,
		configurable: true,
		writable: true
	});
	return error;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/timeout.js
const validateTimeout = ({ timeout }) => {
	if (timeout !== void 0 && (!Number.isFinite(timeout) || timeout < 0)) throw new TypeError(`Expected the \`timeout\` option to be a non-negative integer, got \`${timeout}\` (${typeof timeout})`);
};
const throwOnTimeout = (subprocess, timeout, context, controller) => timeout === 0 || timeout === void 0 ? [] : [killAfterTimeout(subprocess, timeout, context, controller)];
const killAfterTimeout = async (subprocess, timeout, context, { signal }) => {
	await setTimeout(timeout, void 0, { signal });
	context.terminationReason ??= "timeout";
	subprocess.kill();
	throw new DiscardedError();
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/node.js
const mapNode = ({ options }) => {
	if (options.node === false) throw new TypeError("The \"node\" option cannot be false with `execaNode()`.");
	return { options: {
		...options,
		node: true
	} };
};
const handleNodeOption = (file, commandArguments, { node: shouldHandleNode = false, nodePath = execPath, nodeOptions = execArgv.filter((nodeOption) => !nodeOption.startsWith("--inspect")), cwd, execPath: formerNodePath, ...options }) => {
	if (formerNodePath !== void 0) throw new TypeError("The \"execPath\" option has been removed. Please use the \"nodePath\" option instead.");
	const normalizedNodePath = safeNormalizeFileUrl(nodePath, "The \"nodePath\" option");
	const resolvedNodePath = path.resolve(cwd, normalizedNodePath);
	const newOptions = {
		...options,
		nodePath: resolvedNodePath,
		node: shouldHandleNode,
		cwd
	};
	if (!shouldHandleNode) return [
		file,
		commandArguments,
		newOptions
	];
	if (path.basename(file, ".exe") === "node") throw new TypeError("When the \"node\" option is true, the first argument does not need to be \"node\".");
	return [
		resolvedNodePath,
		[
			...nodeOptions,
			file,
			...commandArguments
		],
		{
			ipc: true,
			...newOptions,
			shell: false
		}
	];
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/ipc-input.js
const validateIpcInputOption = ({ ipcInput, ipc, serialization }) => {
	if (ipcInput === void 0) return;
	if (!ipc) throw new Error("The `ipcInput` option cannot be set unless the `ipc` option is `true`.");
	validateIpcInput[serialization](ipcInput);
};
const validateAdvancedInput = (ipcInput) => {
	try {
		serialize(ipcInput);
	} catch (error) {
		throw new Error("The `ipcInput` option is not serializable with a structured clone.", { cause: error });
	}
};
const validateJsonInput = (ipcInput) => {
	try {
		JSON.stringify(ipcInput);
	} catch (error) {
		throw new Error("The `ipcInput` option is not serializable with JSON.", { cause: error });
	}
};
const validateIpcInput = {
	advanced: validateAdvancedInput,
	json: validateJsonInput
};
const sendIpcInput = async (subprocess, ipcInput) => {
	if (ipcInput === void 0) return;
	await subprocess.sendMessage(ipcInput);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/encoding-option.js
const validateEncoding = ({ encoding }) => {
	if (ENCODINGS.has(encoding)) return;
	const correctEncoding = getCorrectEncoding(encoding);
	if (correctEncoding !== void 0) throw new TypeError(`Invalid option \`encoding: ${serializeEncoding(encoding)}\`.
Please rename it to ${serializeEncoding(correctEncoding)}.`);
	const correctEncodings = [...ENCODINGS].map((correctEncoding) => serializeEncoding(correctEncoding)).join(", ");
	throw new TypeError(`Invalid option \`encoding: ${serializeEncoding(encoding)}\`.
Please rename it to one of: ${correctEncodings}.`);
};
const TEXT_ENCODINGS = /* @__PURE__ */ new Set(["utf8", "utf16le"]);
const BINARY_ENCODINGS = /* @__PURE__ */ new Set([
	"buffer",
	"hex",
	"base64",
	"base64url",
	"latin1",
	"ascii"
]);
const ENCODINGS = /* @__PURE__ */ new Set([...TEXT_ENCODINGS, ...BINARY_ENCODINGS]);
const getCorrectEncoding = (encoding) => {
	if (encoding === null) return "buffer";
	if (typeof encoding !== "string") return;
	const lowerEncoding = encoding.toLowerCase();
	if (lowerEncoding in ENCODING_ALIASES) return ENCODING_ALIASES[lowerEncoding];
	if (ENCODINGS.has(lowerEncoding)) return lowerEncoding;
};
const ENCODING_ALIASES = {
	"utf-8": "utf8",
	"utf-16le": "utf16le",
	"ucs-2": "utf16le",
	ucs2: "utf16le",
	binary: "latin1"
};
const serializeEncoding = (encoding) => typeof encoding === "string" ? `"${encoding}"` : String(encoding);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/cwd.js
const normalizeCwd = (cwd = getDefaultCwd()) => {
	const cwdString = safeNormalizeFileUrl(cwd, "The \"cwd\" option");
	return path.resolve(cwdString);
};
const getDefaultCwd = () => {
	try {
		return process$1.cwd();
	} catch (error) {
		error.message = `The current directory does not exist.\n${error.message}`;
		throw error;
	}
};
const fixCwdError = (originalMessage, cwd) => {
	if (cwd === getDefaultCwd()) return originalMessage;
	let cwdStat;
	try {
		cwdStat = statSync(cwd);
	} catch (error) {
		return `The "cwd" option is invalid: ${cwd}.\n${error.message}\n${originalMessage}`;
	}
	if (!cwdStat.isDirectory()) return `The "cwd" option is not a directory: ${cwd}.\n${originalMessage}`;
	return originalMessage;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/options.js
const normalizeOptions = (filePath, rawArguments, rawOptions) => {
	rawOptions.cwd = normalizeCwd(rawOptions.cwd);
	const [processedFile, processedArguments, processedOptions] = handleNodeOption(filePath, rawArguments, rawOptions);
	const { command: file, args: commandArguments, options: initialOptions } = import_cross_spawn.default._parse(processedFile, processedArguments, processedOptions);
	const fdOptions = normalizeFdSpecificOptions(initialOptions);
	const options = addDefaultOptions(fdOptions);
	validateTimeout(options);
	validateEncoding(options);
	validateIpcInputOption(options);
	validateCancelSignal(options);
	validateGracefulCancel(options);
	options.shell = normalizeFileUrl(options.shell);
	options.env = getEnv(options);
	options.killSignal = normalizeKillSignal(options.killSignal);
	options.forceKillAfterDelay = normalizeForceKillAfterDelay(options.forceKillAfterDelay);
	options.lines = options.lines.map((lines, fdNumber) => lines && !BINARY_ENCODINGS.has(options.encoding) && options.buffer[fdNumber]);
	if (process$1.platform === "win32" && path.basename(file, ".exe") === "cmd") commandArguments.unshift("/q");
	return {
		file,
		commandArguments,
		options
	};
};
const addDefaultOptions = ({ extendEnv = true, preferLocal = false, cwd, localDir: localDirectory = cwd, encoding = "utf8", reject = true, cleanup = true, all = false, windowsHide = true, killSignal = "SIGTERM", forceKillAfterDelay = true, gracefulCancel = false, ipcInput, ipc = ipcInput !== void 0 || gracefulCancel, serialization = "advanced", ...options }) => ({
	...options,
	extendEnv,
	preferLocal,
	cwd,
	localDirectory,
	encoding,
	reject,
	cleanup,
	all,
	windowsHide,
	killSignal,
	forceKillAfterDelay,
	gracefulCancel,
	ipcInput,
	ipc,
	serialization
});
const getEnv = ({ env: envOption, extendEnv, preferLocal, node, localDirectory, nodePath }) => {
	const env = extendEnv ? {
		...process$1.env,
		...envOption
	} : envOption;
	if (preferLocal || node) return npmRunPathEnv({
		env,
		cwd: localDirectory,
		execPath: nodePath,
		preferLocal,
		addExecPath: node
	});
	return env;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/arguments/shell.js
const concatenateShell = (file, commandArguments, options) => options.shell && commandArguments.length > 0 ? [
	[file, ...commandArguments].join(" "),
	[],
	options
] : [
	file,
	commandArguments,
	options
];

//#endregion
//#region ../../node_modules/.pnpm/strip-final-newline@4.0.0/node_modules/strip-final-newline/index.js
function stripFinalNewline(input) {
	if (typeof input === "string") return stripFinalNewlineString(input);
	if (!(ArrayBuffer.isView(input) && input.BYTES_PER_ELEMENT === 1)) throw new Error("Input must be a string or a Uint8Array");
	return stripFinalNewlineBinary(input);
}
const stripFinalNewlineString = (input) => input.at(-1) === LF ? input.slice(0, input.at(-2) === CR ? -2 : -1) : input;
const stripFinalNewlineBinary = (input) => input.at(-1) === LF_BINARY ? input.subarray(0, input.at(-2) === CR_BINARY ? -2 : -1) : input;
const LF = "\n";
const LF_BINARY = LF.codePointAt(0);
const CR = "\r";
const CR_BINARY = CR.codePointAt(0);

//#endregion
//#region ../../node_modules/.pnpm/is-stream@4.0.1/node_modules/is-stream/index.js
function isStream(stream, { checkOpen = true } = {}) {
	return stream !== null && typeof stream === "object" && (stream.writable || stream.readable || !checkOpen || stream.writable === void 0 && stream.readable === void 0) && typeof stream.pipe === "function";
}
function isWritableStream$1(stream, { checkOpen = true } = {}) {
	return isStream(stream, { checkOpen }) && (stream.writable || !checkOpen) && typeof stream.write === "function" && typeof stream.end === "function" && typeof stream.writable === "boolean" && typeof stream.writableObjectMode === "boolean" && typeof stream.destroy === "function" && typeof stream.destroyed === "boolean";
}
function isReadableStream$1(stream, { checkOpen = true } = {}) {
	return isStream(stream, { checkOpen }) && (stream.readable || !checkOpen) && typeof stream.read === "function" && typeof stream.readable === "boolean" && typeof stream.readableObjectMode === "boolean" && typeof stream.destroy === "function" && typeof stream.destroyed === "boolean";
}
function isDuplexStream(stream, options) {
	return isWritableStream$1(stream, options) && isReadableStream$1(stream, options);
}

//#endregion
//#region ../../node_modules/.pnpm/@sec-ant+readable-stream@0.4.1/node_modules/@sec-ant/readable-stream/dist/ponyfill/asyncIterator.js
const a = Object.getPrototypeOf(Object.getPrototypeOf(
	/* istanbul ignore next */
	async function* () {}
).prototype);
var c = class {
	#t;
	#n;
	#r = !1;
	#e = void 0;
	constructor(e, t) {
		this.#t = e, this.#n = t;
	}
	next() {
		const e = () => this.#s();
		return this.#e = this.#e ? this.#e.then(e, e) : e(), this.#e;
	}
	return(e) {
		const t = () => this.#i(e);
		return this.#e ? this.#e.then(t, t) : t();
	}
	async #s() {
		if (this.#r) return {
			done: !0,
			value: void 0
		};
		let e;
		try {
			e = await this.#t.read();
		} catch (t) {
			throw this.#e = void 0, this.#r = !0, this.#t.releaseLock(), t;
		}
		return e.done && (this.#e = void 0, this.#r = !0, this.#t.releaseLock()), e;
	}
	async #i(e) {
		if (this.#r) return {
			done: !0,
			value: e
		};
		if (this.#r = !0, !this.#n) {
			const t = this.#t.cancel(e);
			return this.#t.releaseLock(), await t, {
				done: !0,
				value: e
			};
		}
		return this.#t.releaseLock(), {
			done: !0,
			value: e
		};
	}
};
const n = Symbol();
function i() {
	return this[n].next();
}
Object.defineProperty(i, "name", { value: "next" });
function o(r) {
	return this[n].return(r);
}
Object.defineProperty(o, "name", { value: "return" });
const u = Object.create(a, {
	next: {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: i
	},
	return: {
		enumerable: !0,
		configurable: !0,
		writable: !0,
		value: o
	}
});
function h({ preventCancel: r = !1 } = {}) {
	const e = this.getReader(), t = new c(e, r), s = Object.create(u);
	return s[n] = t, s;
}

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/stream.js
const getAsyncIterable = (stream) => {
	if (isReadableStream$1(stream, { checkOpen: false }) && nodeImports.on !== void 0) return getStreamIterable(stream);
	if (typeof stream?.[Symbol.asyncIterator] === "function") return stream;
	if (toString.call(stream) === "[object ReadableStream]") return h.call(stream);
	throw new TypeError("The first argument must be a Readable, a ReadableStream, or an async iterable.");
};
const { toString } = Object.prototype;
const getStreamIterable = async function* (stream) {
	const controller = new AbortController();
	const state = {};
	handleStreamEnd(stream, controller, state);
	try {
		for await (const [chunk] of nodeImports.on(stream, "data", { signal: controller.signal })) yield chunk;
	} catch (error) {
		if (state.error !== void 0) throw state.error;
		else if (!controller.signal.aborted) throw error;
	} finally {
		stream.destroy();
	}
};
const handleStreamEnd = async (stream, controller, state) => {
	try {
		await nodeImports.finished(stream, {
			cleanup: true,
			readable: true,
			writable: false,
			error: false
		});
	} catch (error) {
		state.error = error;
	} finally {
		controller.abort();
	}
};
const nodeImports = {};

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/contents.js
const getStreamContents$1 = async (stream, { init, convertChunk, getSize, truncateChunk, addChunk, getFinalChunk, finalize }, { maxBuffer = Number.POSITIVE_INFINITY } = {}) => {
	const asyncIterable = getAsyncIterable(stream);
	const state = init();
	state.length = 0;
	try {
		for await (const chunk of asyncIterable) {
			const convertedChunk = convertChunk[getChunkType(chunk)](chunk, state);
			appendChunk({
				convertedChunk,
				state,
				getSize,
				truncateChunk,
				addChunk,
				maxBuffer
			});
		}
		appendFinalChunk({
			state,
			convertChunk,
			getSize,
			truncateChunk,
			addChunk,
			getFinalChunk,
			maxBuffer
		});
		return finalize(state);
	} catch (error) {
		const normalizedError = typeof error === "object" && error !== null ? error : new Error(error);
		normalizedError.bufferedData = finalize(state);
		throw normalizedError;
	}
};
const appendFinalChunk = ({ state, getSize, truncateChunk, addChunk, getFinalChunk, maxBuffer }) => {
	const convertedChunk = getFinalChunk(state);
	if (convertedChunk !== void 0) appendChunk({
		convertedChunk,
		state,
		getSize,
		truncateChunk,
		addChunk,
		maxBuffer
	});
};
const appendChunk = ({ convertedChunk, state, getSize, truncateChunk, addChunk, maxBuffer }) => {
	const chunkSize = getSize(convertedChunk);
	const newLength = state.length + chunkSize;
	if (newLength <= maxBuffer) {
		addNewChunk(convertedChunk, state, addChunk, newLength);
		return;
	}
	const truncatedChunk = truncateChunk(convertedChunk, maxBuffer - state.length);
	if (truncatedChunk !== void 0) addNewChunk(truncatedChunk, state, addChunk, maxBuffer);
	throw new MaxBufferError();
};
const addNewChunk = (convertedChunk, state, addChunk, newLength) => {
	state.contents = addChunk(convertedChunk, state, newLength);
	state.length = newLength;
};
const getChunkType = (chunk) => {
	const typeOfChunk = typeof chunk;
	if (typeOfChunk === "string") return "string";
	if (typeOfChunk !== "object" || chunk === null) return "others";
	if (globalThis.Buffer?.isBuffer(chunk)) return "buffer";
	const prototypeName = objectToString.call(chunk);
	if (prototypeName === "[object ArrayBuffer]") return "arrayBuffer";
	if (prototypeName === "[object DataView]") return "dataView";
	if (Number.isInteger(chunk.byteLength) && Number.isInteger(chunk.byteOffset) && objectToString.call(chunk.buffer) === "[object ArrayBuffer]") return "typedArray";
	return "others";
};
const { toString: objectToString } = Object.prototype;
var MaxBufferError = class extends Error {
	name = "MaxBufferError";
	constructor() {
		super("maxBuffer exceeded");
	}
};

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/utils.js
const identity = (value) => value;
const noop$1 = () => void 0;
const getContentsProperty = ({ contents }) => contents;
const throwObjectStream = (chunk) => {
	throw new Error(`Streams in object mode are not supported: ${String(chunk)}`);
};
const getLengthProperty = (convertedChunk) => convertedChunk.length;

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/array.js
async function getStreamAsArray(stream, options) {
	return getStreamContents$1(stream, arrayMethods, options);
}
const initArray = () => ({ contents: [] });
const increment = () => 1;
const addArrayChunk = (convertedChunk, { contents }) => {
	contents.push(convertedChunk);
	return contents;
};
const arrayMethods = {
	init: initArray,
	convertChunk: {
		string: identity,
		buffer: identity,
		arrayBuffer: identity,
		dataView: identity,
		typedArray: identity,
		others: identity
	},
	getSize: increment,
	truncateChunk: noop$1,
	addChunk: addArrayChunk,
	getFinalChunk: noop$1,
	finalize: getContentsProperty
};

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/array-buffer.js
async function getStreamAsArrayBuffer(stream, options) {
	return getStreamContents$1(stream, arrayBufferMethods, options);
}
const initArrayBuffer = () => ({ contents: /* @__PURE__ */ new ArrayBuffer(0) });
const useTextEncoder = (chunk) => textEncoder.encode(chunk);
const textEncoder = new TextEncoder();
const useUint8Array = (chunk) => new Uint8Array(chunk);
const useUint8ArrayWithOffset = (chunk) => new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength);
const truncateArrayBufferChunk = (convertedChunk, chunkSize) => convertedChunk.slice(0, chunkSize);
const addArrayBufferChunk = (convertedChunk, { contents, length: previousLength }, length) => {
	const newContents = hasArrayBufferResize() ? resizeArrayBuffer(contents, length) : resizeArrayBufferSlow(contents, length);
	new Uint8Array(newContents).set(convertedChunk, previousLength);
	return newContents;
};
const resizeArrayBufferSlow = (contents, length) => {
	if (length <= contents.byteLength) return contents;
	const arrayBuffer = new ArrayBuffer(getNewContentsLength(length));
	new Uint8Array(arrayBuffer).set(new Uint8Array(contents), 0);
	return arrayBuffer;
};
const resizeArrayBuffer = (contents, length) => {
	if (length <= contents.maxByteLength) {
		contents.resize(length);
		return contents;
	}
	const arrayBuffer = new ArrayBuffer(length, { maxByteLength: getNewContentsLength(length) });
	new Uint8Array(arrayBuffer).set(new Uint8Array(contents), 0);
	return arrayBuffer;
};
const getNewContentsLength = (length) => SCALE_FACTOR ** Math.ceil(Math.log(length) / Math.log(SCALE_FACTOR));
const SCALE_FACTOR = 2;
const finalizeArrayBuffer = ({ contents, length }) => hasArrayBufferResize() ? contents : contents.slice(0, length);
const hasArrayBufferResize = () => "resize" in ArrayBuffer.prototype;
const arrayBufferMethods = {
	init: initArrayBuffer,
	convertChunk: {
		string: useTextEncoder,
		buffer: useUint8Array,
		arrayBuffer: useUint8Array,
		dataView: useUint8ArrayWithOffset,
		typedArray: useUint8ArrayWithOffset,
		others: throwObjectStream
	},
	getSize: getLengthProperty,
	truncateChunk: truncateArrayBufferChunk,
	addChunk: addArrayBufferChunk,
	getFinalChunk: noop$1,
	finalize: finalizeArrayBuffer
};

//#endregion
//#region ../../node_modules/.pnpm/get-stream@9.0.1/node_modules/get-stream/source/string.js
async function getStreamAsString(stream, options) {
	return getStreamContents$1(stream, stringMethods, options);
}
const initString = () => ({
	contents: "",
	textDecoder: new TextDecoder()
});
const useTextDecoder = (chunk, { textDecoder }) => textDecoder.decode(chunk, { stream: true });
const addStringChunk = (convertedChunk, { contents }) => contents + convertedChunk;
const truncateStringChunk = (convertedChunk, chunkSize) => convertedChunk.slice(0, chunkSize);
const getFinalStringChunk = ({ textDecoder }) => {
	const finalChunk = textDecoder.decode();
	return finalChunk === "" ? void 0 : finalChunk;
};
const stringMethods = {
	init: initString,
	convertChunk: {
		string: identity,
		buffer: useTextDecoder,
		arrayBuffer: useTextDecoder,
		dataView: useTextDecoder,
		typedArray: useTextDecoder,
		others: throwObjectStream
	},
	getSize: getLengthProperty,
	truncateChunk: truncateStringChunk,
	addChunk: addStringChunk,
	getFinalChunk: getFinalStringChunk,
	finalize: getContentsProperty
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/max-buffer.js
const handleMaxBuffer = ({ error, stream, readableObjectMode, lines, encoding, fdNumber }) => {
	if (!(error instanceof MaxBufferError)) throw error;
	if (fdNumber === "all") return error;
	error.maxBufferInfo = {
		fdNumber,
		unit: getMaxBufferUnit(readableObjectMode, lines, encoding)
	};
	stream.destroy();
	throw error;
};
const getMaxBufferUnit = (readableObjectMode, lines, encoding) => {
	if (readableObjectMode) return "objects";
	if (lines) return "lines";
	if (encoding === "buffer") return "bytes";
	return "characters";
};
const checkIpcMaxBuffer = (subprocess, ipcOutput, maxBuffer) => {
	if (ipcOutput.length !== maxBuffer) return;
	const error = new MaxBufferError();
	error.maxBufferInfo = { fdNumber: "ipc" };
	throw error;
};
const getMaxBufferMessage = (error, maxBuffer) => {
	const { streamName, threshold, unit } = getMaxBufferInfo(error, maxBuffer);
	return `Command's ${streamName} was larger than ${threshold} ${unit}`;
};
const getMaxBufferInfo = (error, maxBuffer) => {
	if (error?.maxBufferInfo === void 0) return {
		streamName: "output",
		threshold: maxBuffer[1],
		unit: "bytes"
	};
	const { maxBufferInfo: { fdNumber, unit } } = error;
	delete error.maxBufferInfo;
	const threshold = getFdSpecificValue(maxBuffer, fdNumber);
	if (fdNumber === "ipc") return {
		streamName: "IPC output",
		threshold,
		unit: "messages"
	};
	return {
		streamName: getStreamName(fdNumber),
		threshold,
		unit
	};
};
const isMaxBufferSync = (resultError, output, maxBuffer) => resultError?.code === "ENOBUFS" && output !== null && output.some((result) => result !== null && result.length > getMaxBufferSync(maxBuffer));
const truncateMaxBufferSync = (result, isMaxBuffer, maxBuffer) => {
	if (!isMaxBuffer) return result;
	const maxBufferValue = getMaxBufferSync(maxBuffer);
	return result.length > maxBufferValue ? result.slice(0, maxBufferValue) : result;
};
const getMaxBufferSync = ([, stdoutMaxBuffer]) => stdoutMaxBuffer;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/message.js
const createMessages = ({ stdio, all, ipcOutput, originalError, signal, signalDescription, exitCode, escapedCommand, timedOut, isCanceled, isGracefullyCanceled, isMaxBuffer, isForcefullyTerminated, forceKillAfterDelay, killSignal, maxBuffer, timeout, cwd }) => {
	const errorCode = originalError?.code;
	const prefix = getErrorPrefix({
		originalError,
		timedOut,
		timeout,
		isMaxBuffer,
		maxBuffer,
		errorCode,
		signal,
		signalDescription,
		exitCode,
		isCanceled,
		isGracefullyCanceled,
		isForcefullyTerminated,
		forceKillAfterDelay,
		killSignal
	});
	const originalMessage = getOriginalMessage(originalError, cwd);
	const shortMessage = `${prefix}: ${escapedCommand}${originalMessage === void 0 ? "" : `\n${originalMessage}`}`;
	return {
		originalMessage,
		shortMessage,
		message: [
			shortMessage,
			...all === void 0 ? [stdio[2], stdio[1]] : [all],
			...stdio.slice(3),
			ipcOutput.map((ipcMessage) => serializeIpcMessage(ipcMessage)).join("\n")
		].map((messagePart) => escapeLines(stripFinalNewline(serializeMessagePart(messagePart)))).filter(Boolean).join("\n\n")
	};
};
const getErrorPrefix = ({ originalError, timedOut, timeout, isMaxBuffer, maxBuffer, errorCode, signal, signalDescription, exitCode, isCanceled, isGracefullyCanceled, isForcefullyTerminated, forceKillAfterDelay, killSignal }) => {
	const forcefulSuffix = getForcefulSuffix(isForcefullyTerminated, forceKillAfterDelay);
	if (timedOut) return `Command timed out after ${timeout} milliseconds${forcefulSuffix}`;
	if (isGracefullyCanceled) {
		if (signal === void 0) return `Command was gracefully canceled with exit code ${exitCode}`;
		return isForcefullyTerminated ? `Command was gracefully canceled${forcefulSuffix}` : `Command was gracefully canceled with ${signal} (${signalDescription})`;
	}
	if (isCanceled) return `Command was canceled${forcefulSuffix}`;
	if (isMaxBuffer) return `${getMaxBufferMessage(originalError, maxBuffer)}${forcefulSuffix}`;
	if (errorCode !== void 0) return `Command failed with ${errorCode}${forcefulSuffix}`;
	if (isForcefullyTerminated) return `Command was killed with ${killSignal} (${getSignalDescription(killSignal)})${forcefulSuffix}`;
	if (signal !== void 0) return `Command was killed with ${signal} (${signalDescription})`;
	if (exitCode !== void 0) return `Command failed with exit code ${exitCode}`;
	return "Command failed";
};
const getForcefulSuffix = (isForcefullyTerminated, forceKillAfterDelay) => isForcefullyTerminated ? ` and was forcefully terminated after ${forceKillAfterDelay} milliseconds` : "";
const getOriginalMessage = (originalError, cwd) => {
	if (originalError instanceof DiscardedError) return;
	const escapedOriginalMessage = escapeLines(fixCwdError(isExecaError(originalError) ? originalError.originalMessage : String(originalError?.message ?? originalError), cwd));
	return escapedOriginalMessage === "" ? void 0 : escapedOriginalMessage;
};
const serializeIpcMessage = (ipcMessage) => typeof ipcMessage === "string" ? ipcMessage : inspect(ipcMessage);
const serializeMessagePart = (messagePart) => Array.isArray(messagePart) ? messagePart.map((messageItem) => stripFinalNewline(serializeMessageItem(messageItem))).filter(Boolean).join("\n") : serializeMessageItem(messagePart);
const serializeMessageItem = (messageItem) => {
	if (typeof messageItem === "string") return messageItem;
	if (isUint8Array(messageItem)) return uint8ArrayToString(messageItem);
	return "";
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/result.js
const makeSuccessResult = ({ command, escapedCommand, stdio, all, ipcOutput, options: { cwd }, startTime }) => omitUndefinedProperties({
	command,
	escapedCommand,
	cwd,
	durationMs: getDurationMs(startTime),
	failed: false,
	timedOut: false,
	isCanceled: false,
	isGracefullyCanceled: false,
	isTerminated: false,
	isMaxBuffer: false,
	isForcefullyTerminated: false,
	exitCode: 0,
	stdout: stdio[1],
	stderr: stdio[2],
	all,
	stdio,
	ipcOutput,
	pipedFrom: []
});
const makeEarlyError = ({ error, command, escapedCommand, fileDescriptors, options, startTime, isSync }) => makeError({
	error,
	command,
	escapedCommand,
	startTime,
	timedOut: false,
	isCanceled: false,
	isGracefullyCanceled: false,
	isMaxBuffer: false,
	isForcefullyTerminated: false,
	stdio: Array.from({ length: fileDescriptors.length }),
	ipcOutput: [],
	options,
	isSync
});
const makeError = ({ error: originalError, command, escapedCommand, startTime, timedOut, isCanceled, isGracefullyCanceled, isMaxBuffer, isForcefullyTerminated, exitCode: rawExitCode, signal: rawSignal, stdio, all, ipcOutput, options: { timeoutDuration, timeout = timeoutDuration, forceKillAfterDelay, killSignal, cwd, maxBuffer }, isSync }) => {
	const { exitCode, signal, signalDescription } = normalizeExitPayload(rawExitCode, rawSignal);
	const { originalMessage, shortMessage, message } = createMessages({
		stdio,
		all,
		ipcOutput,
		originalError,
		signal,
		signalDescription,
		exitCode,
		escapedCommand,
		timedOut,
		isCanceled,
		isGracefullyCanceled,
		isMaxBuffer,
		isForcefullyTerminated,
		forceKillAfterDelay,
		killSignal,
		maxBuffer,
		timeout,
		cwd
	});
	const error = getFinalError(originalError, message, isSync);
	Object.assign(error, getErrorProperties({
		error,
		command,
		escapedCommand,
		startTime,
		timedOut,
		isCanceled,
		isGracefullyCanceled,
		isMaxBuffer,
		isForcefullyTerminated,
		exitCode,
		signal,
		signalDescription,
		stdio,
		all,
		ipcOutput,
		cwd,
		originalMessage,
		shortMessage
	}));
	return error;
};
const getErrorProperties = ({ error, command, escapedCommand, startTime, timedOut, isCanceled, isGracefullyCanceled, isMaxBuffer, isForcefullyTerminated, exitCode, signal, signalDescription, stdio, all, ipcOutput, cwd, originalMessage, shortMessage }) => omitUndefinedProperties({
	shortMessage,
	originalMessage,
	command,
	escapedCommand,
	cwd,
	durationMs: getDurationMs(startTime),
	failed: true,
	timedOut,
	isCanceled,
	isGracefullyCanceled,
	isTerminated: signal !== void 0,
	isMaxBuffer,
	isForcefullyTerminated,
	exitCode,
	signal,
	signalDescription,
	code: error.cause?.code,
	stdout: stdio[1],
	stderr: stdio[2],
	all,
	stdio,
	ipcOutput,
	pipedFrom: []
});
const omitUndefinedProperties = (result) => Object.fromEntries(Object.entries(result).filter(([, value]) => value !== void 0));
const normalizeExitPayload = (rawExitCode, rawSignal) => {
	const exitCode = rawExitCode === null ? void 0 : rawExitCode;
	const signal = rawSignal === null ? void 0 : rawSignal;
	return {
		exitCode,
		signal,
		signalDescription: signal === void 0 ? void 0 : getSignalDescription(rawSignal)
	};
};

//#endregion
//#region ../../node_modules/.pnpm/parse-ms@4.0.0/node_modules/parse-ms/index.js
const toZeroIfInfinity = (value) => Number.isFinite(value) ? value : 0;
function parseNumber(milliseconds) {
	return {
		days: Math.trunc(milliseconds / 864e5),
		hours: Math.trunc(milliseconds / 36e5 % 24),
		minutes: Math.trunc(milliseconds / 6e4 % 60),
		seconds: Math.trunc(milliseconds / 1e3 % 60),
		milliseconds: Math.trunc(milliseconds % 1e3),
		microseconds: Math.trunc(toZeroIfInfinity(milliseconds * 1e3) % 1e3),
		nanoseconds: Math.trunc(toZeroIfInfinity(milliseconds * 1e6) % 1e3)
	};
}
function parseBigint(milliseconds) {
	return {
		days: milliseconds / 86400000n,
		hours: milliseconds / 3600000n % 24n,
		minutes: milliseconds / 60000n % 60n,
		seconds: milliseconds / 1000n % 60n,
		milliseconds: milliseconds % 1000n,
		microseconds: 0n,
		nanoseconds: 0n
	};
}
function parseMilliseconds(milliseconds) {
	switch (typeof milliseconds) {
		case "number":
			if (Number.isFinite(milliseconds)) return parseNumber(milliseconds);
			break;
		case "bigint": return parseBigint(milliseconds);
	}
	throw new TypeError("Expected a finite number or bigint");
}

//#endregion
//#region ../../node_modules/.pnpm/pretty-ms@9.3.0/node_modules/pretty-ms/index.js
const isZero = (value) => value === 0 || value === 0n;
const pluralize = (word, count) => count === 1 || count === 1n ? word : `${word}s`;
const SECOND_ROUNDING_EPSILON = 1e-7;
const ONE_DAY_IN_MILLISECONDS = 24n * 60n * 60n * 1000n;
function prettyMilliseconds(milliseconds, options) {
	const isBigInt = typeof milliseconds === "bigint";
	if (!isBigInt && !Number.isFinite(milliseconds)) throw new TypeError("Expected a finite number or bigint");
	options = { ...options };
	const sign = milliseconds < 0 ? "-" : "";
	milliseconds = milliseconds < 0 ? -milliseconds : milliseconds;
	if (options.colonNotation) {
		options.compact = false;
		options.formatSubMilliseconds = false;
		options.separateMilliseconds = false;
		options.verbose = false;
	}
	if (options.compact) {
		options.unitCount = 1;
		options.secondsDecimalDigits = 0;
		options.millisecondsDecimalDigits = 0;
	}
	let result = [];
	const floorDecimals = (value, decimalDigits) => {
		const flooredInterimValue = Math.floor(value * 10 ** decimalDigits + SECOND_ROUNDING_EPSILON);
		return (Math.round(flooredInterimValue) / 10 ** decimalDigits).toFixed(decimalDigits);
	};
	const add = (value, long, short, valueString) => {
		if ((result.length === 0 || !options.colonNotation) && isZero(value) && !(options.colonNotation && short === "m")) return;
		valueString ??= String(value);
		if (options.colonNotation) {
			const wholeDigits = valueString.includes(".") ? valueString.split(".")[0].length : valueString.length;
			const minLength = result.length > 0 ? 2 : 1;
			valueString = "0".repeat(Math.max(0, minLength - wholeDigits)) + valueString;
		} else valueString += options.verbose ? " " + pluralize(long, value) : short;
		result.push(valueString);
	};
	const parsed = parseMilliseconds(milliseconds);
	const days = BigInt(parsed.days);
	if (options.hideYearAndDays) add(BigInt(days) * 24n + BigInt(parsed.hours), "hour", "h");
	else {
		if (options.hideYear) add(days, "day", "d");
		else {
			add(days / 365n, "year", "y");
			add(days % 365n, "day", "d");
		}
		add(Number(parsed.hours), "hour", "h");
	}
	add(Number(parsed.minutes), "minute", "m");
	if (!options.hideSeconds) if (options.separateMilliseconds || options.formatSubMilliseconds || !options.colonNotation && milliseconds < 1e3 && !options.subSecondsAsDecimals) {
		const seconds = Number(parsed.seconds);
		const milliseconds = Number(parsed.milliseconds);
		const microseconds = Number(parsed.microseconds);
		const nanoseconds = Number(parsed.nanoseconds);
		add(seconds, "second", "s");
		if (options.formatSubMilliseconds) {
			add(milliseconds, "millisecond", "ms");
			add(microseconds, "microsecond", "µs");
			add(nanoseconds, "nanosecond", "ns");
		} else {
			const millisecondsAndBelow = milliseconds + microseconds / 1e3 + nanoseconds / 1e6;
			const millisecondsDecimalDigits = typeof options.millisecondsDecimalDigits === "number" ? options.millisecondsDecimalDigits : 0;
			const millisecondsString = millisecondsDecimalDigits ? millisecondsAndBelow.toFixed(millisecondsDecimalDigits) : millisecondsAndBelow >= 1 ? Math.round(millisecondsAndBelow) : Math.ceil(millisecondsAndBelow);
			add(Number.parseFloat(millisecondsString), "millisecond", "ms", millisecondsString);
		}
	} else {
		const secondsFixed = floorDecimals((isBigInt ? Number(milliseconds % ONE_DAY_IN_MILLISECONDS) : milliseconds) / 1e3 % 60, typeof options.secondsDecimalDigits === "number" ? options.secondsDecimalDigits : 1);
		const secondsString = options.keepDecimalsOnWholeSeconds ? secondsFixed : secondsFixed.replace(/\.0+$/, "");
		add(Number.parseFloat(secondsString), "second", "s", secondsString);
	}
	if (result.length === 0) return sign + "0" + (options.verbose ? " milliseconds" : "ms");
	const separator = options.colonNotation ? ":" : " ";
	if (typeof options.unitCount === "number") result = result.slice(0, Math.max(options.unitCount, 1));
	return sign + result.join(separator);
}

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/error.js
const logError = (result, verboseInfo) => {
	if (result.failed) verboseLog({
		type: "error",
		verboseMessage: result.shortMessage,
		verboseInfo,
		result
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/complete.js
const logResult = (result, verboseInfo) => {
	if (!isVerbose(verboseInfo)) return;
	logError(result, verboseInfo);
	logDuration(result, verboseInfo);
};
const logDuration = (result, verboseInfo) => {
	verboseLog({
		type: "duration",
		verboseMessage: `(done in ${prettyMilliseconds(result.durationMs)})`,
		verboseInfo,
		result
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/reject.js
const handleResult = (result, verboseInfo, { reject }) => {
	logResult(result, verboseInfo);
	if (result.failed && reject) throw result;
	return result;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/type.js
const getStdioItemType = (value, optionName) => {
	if (isAsyncGenerator(value)) return "asyncGenerator";
	if (isSyncGenerator(value)) return "generator";
	if (isUrl(value)) return "fileUrl";
	if (isFilePathObject(value)) return "filePath";
	if (isWebStream(value)) return "webStream";
	if (isStream(value, { checkOpen: false })) return "native";
	if (isUint8Array(value)) return "uint8Array";
	if (isAsyncIterableObject(value)) return "asyncIterable";
	if (isIterableObject(value)) return "iterable";
	if (isTransformStream(value)) return getTransformStreamType({ transform: value }, optionName);
	if (isTransformOptions(value)) return getTransformObjectType(value, optionName);
	return "native";
};
const getTransformObjectType = (value, optionName) => {
	if (isDuplexStream(value.transform, { checkOpen: false })) return getDuplexType(value, optionName);
	if (isTransformStream(value.transform)) return getTransformStreamType(value, optionName);
	return getGeneratorObjectType(value, optionName);
};
const getDuplexType = (value, optionName) => {
	validateNonGeneratorType(value, optionName, "Duplex stream");
	return "duplex";
};
const getTransformStreamType = (value, optionName) => {
	validateNonGeneratorType(value, optionName, "web TransformStream");
	return "webTransform";
};
const validateNonGeneratorType = ({ final, binary, objectMode }, optionName, typeName) => {
	checkUndefinedOption(final, `${optionName}.final`, typeName);
	checkUndefinedOption(binary, `${optionName}.binary`, typeName);
	checkBooleanOption(objectMode, `${optionName}.objectMode`);
};
const checkUndefinedOption = (value, optionName, typeName) => {
	if (value !== void 0) throw new TypeError(`The \`${optionName}\` option can only be defined when using a generator, not a ${typeName}.`);
};
const getGeneratorObjectType = ({ transform, final, binary, objectMode }, optionName) => {
	if (transform !== void 0 && !isGenerator(transform)) throw new TypeError(`The \`${optionName}.transform\` option must be a generator, a Duplex stream or a web TransformStream.`);
	if (isDuplexStream(final, { checkOpen: false })) throw new TypeError(`The \`${optionName}.final\` option must not be a Duplex stream.`);
	if (isTransformStream(final)) throw new TypeError(`The \`${optionName}.final\` option must not be a web TransformStream.`);
	if (final !== void 0 && !isGenerator(final)) throw new TypeError(`The \`${optionName}.final\` option must be a generator.`);
	checkBooleanOption(binary, `${optionName}.binary`);
	checkBooleanOption(objectMode, `${optionName}.objectMode`);
	return isAsyncGenerator(transform) || isAsyncGenerator(final) ? "asyncGenerator" : "generator";
};
const checkBooleanOption = (value, optionName) => {
	if (value !== void 0 && typeof value !== "boolean") throw new TypeError(`The \`${optionName}\` option must use a boolean.`);
};
const isGenerator = (value) => isAsyncGenerator(value) || isSyncGenerator(value);
const isAsyncGenerator = (value) => Object.prototype.toString.call(value) === "[object AsyncGeneratorFunction]";
const isSyncGenerator = (value) => Object.prototype.toString.call(value) === "[object GeneratorFunction]";
const isTransformOptions = (value) => isPlainObject$1(value) && (value.transform !== void 0 || value.final !== void 0);
const isUrl = (value) => Object.prototype.toString.call(value) === "[object URL]";
const isRegularUrl = (value) => isUrl(value) && value.protocol !== "file:";
const isFilePathObject = (value) => isPlainObject$1(value) && Object.keys(value).length > 0 && Object.keys(value).every((key) => FILE_PATH_KEYS.has(key)) && isFilePathString(value.file);
const FILE_PATH_KEYS = /* @__PURE__ */ new Set(["file", "append"]);
const isFilePathString = (file) => typeof file === "string";
const isUnknownStdioString = (type, value) => type === "native" && typeof value === "string" && !KNOWN_STDIO_STRINGS.has(value);
const KNOWN_STDIO_STRINGS = /* @__PURE__ */ new Set([
	"ipc",
	"ignore",
	"inherit",
	"overlapped",
	"pipe"
]);
const isReadableStream = (value) => Object.prototype.toString.call(value) === "[object ReadableStream]";
const isWritableStream = (value) => Object.prototype.toString.call(value) === "[object WritableStream]";
const isWebStream = (value) => isReadableStream(value) || isWritableStream(value);
const isTransformStream = (value) => isReadableStream(value?.readable) && isWritableStream(value?.writable);
const isAsyncIterableObject = (value) => isObject(value) && typeof value[Symbol.asyncIterator] === "function";
const isIterableObject = (value) => isObject(value) && typeof value[Symbol.iterator] === "function";
const isObject = (value) => typeof value === "object" && value !== null;
const TRANSFORM_TYPES = /* @__PURE__ */ new Set([
	"generator",
	"asyncGenerator",
	"duplex",
	"webTransform"
]);
const FILE_TYPES = /* @__PURE__ */ new Set([
	"fileUrl",
	"filePath",
	"fileNumber"
]);
const SPECIAL_DUPLICATE_TYPES_SYNC = /* @__PURE__ */ new Set(["fileUrl", "filePath"]);
const SPECIAL_DUPLICATE_TYPES = /* @__PURE__ */ new Set([
	...SPECIAL_DUPLICATE_TYPES_SYNC,
	"webStream",
	"nodeStream"
]);
const FORBID_DUPLICATE_TYPES = /* @__PURE__ */ new Set(["webTransform", "duplex"]);
const TYPE_TO_MESSAGE = {
	generator: "a generator",
	asyncGenerator: "an async generator",
	fileUrl: "a file URL",
	filePath: "a file path string",
	fileNumber: "a file descriptor number",
	webStream: "a web stream",
	nodeStream: "a Node.js stream",
	webTransform: "a web TransformStream",
	duplex: "a Duplex stream",
	native: "any value",
	iterable: "an iterable",
	asyncIterable: "an async iterable",
	string: "a string",
	uint8Array: "a Uint8Array"
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/object-mode.js
const getTransformObjectModes = (objectMode, index, newTransforms, direction) => direction === "output" ? getOutputObjectModes(objectMode, index, newTransforms) : getInputObjectModes(objectMode, index, newTransforms);
const getOutputObjectModes = (objectMode, index, newTransforms) => {
	const writableObjectMode = index !== 0 && newTransforms[index - 1].value.readableObjectMode;
	return {
		writableObjectMode,
		readableObjectMode: objectMode ?? writableObjectMode
	};
};
const getInputObjectModes = (objectMode, index, newTransforms) => {
	const writableObjectMode = index === 0 ? objectMode === true : newTransforms[index - 1].value.readableObjectMode;
	return {
		writableObjectMode,
		readableObjectMode: index !== newTransforms.length - 1 && (objectMode ?? writableObjectMode)
	};
};
const getFdObjectMode = (stdioItems, direction) => {
	const lastTransform = stdioItems.findLast(({ type }) => TRANSFORM_TYPES.has(type));
	if (lastTransform === void 0) return false;
	return direction === "input" ? lastTransform.value.writableObjectMode : lastTransform.value.readableObjectMode;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/normalize.js
const normalizeTransforms = (stdioItems, optionName, direction, options) => [...stdioItems.filter(({ type }) => !TRANSFORM_TYPES.has(type)), ...getTransforms(stdioItems, optionName, direction, options)];
const getTransforms = (stdioItems, optionName, direction, { encoding }) => {
	const transforms = stdioItems.filter(({ type }) => TRANSFORM_TYPES.has(type));
	const newTransforms = Array.from({ length: transforms.length });
	for (const [index, stdioItem] of Object.entries(transforms)) newTransforms[index] = normalizeTransform({
		stdioItem,
		index: Number(index),
		newTransforms,
		optionName,
		direction,
		encoding
	});
	return sortTransforms(newTransforms, direction);
};
const normalizeTransform = ({ stdioItem, stdioItem: { type }, index, newTransforms, optionName, direction, encoding }) => {
	if (type === "duplex") return normalizeDuplex({
		stdioItem,
		optionName
	});
	if (type === "webTransform") return normalizeTransformStream({
		stdioItem,
		index,
		newTransforms,
		direction
	});
	return normalizeGenerator({
		stdioItem,
		index,
		newTransforms,
		direction,
		encoding
	});
};
const normalizeDuplex = ({ stdioItem, stdioItem: { value: { transform, transform: { writableObjectMode, readableObjectMode }, objectMode = readableObjectMode } }, optionName }) => {
	if (objectMode && !readableObjectMode) throw new TypeError(`The \`${optionName}.objectMode\` option can only be \`true\` if \`new Duplex({objectMode: true})\` is used.`);
	if (!objectMode && readableObjectMode) throw new TypeError(`The \`${optionName}.objectMode\` option cannot be \`false\` if \`new Duplex({objectMode: true})\` is used.`);
	return {
		...stdioItem,
		value: {
			transform,
			writableObjectMode,
			readableObjectMode
		}
	};
};
const normalizeTransformStream = ({ stdioItem, stdioItem: { value }, index, newTransforms, direction }) => {
	const { transform, objectMode } = isPlainObject$1(value) ? value : { transform: value };
	const { writableObjectMode, readableObjectMode } = getTransformObjectModes(objectMode, index, newTransforms, direction);
	return {
		...stdioItem,
		value: {
			transform,
			writableObjectMode,
			readableObjectMode
		}
	};
};
const normalizeGenerator = ({ stdioItem, stdioItem: { value }, index, newTransforms, direction, encoding }) => {
	const { transform, final, binary: binaryOption = false, preserveNewlines = false, objectMode } = isPlainObject$1(value) ? value : { transform: value };
	const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
	const { writableObjectMode, readableObjectMode } = getTransformObjectModes(objectMode, index, newTransforms, direction);
	return {
		...stdioItem,
		value: {
			transform,
			final,
			binary,
			preserveNewlines,
			writableObjectMode,
			readableObjectMode
		}
	};
};
const sortTransforms = (newTransforms, direction) => direction === "input" ? newTransforms.reverse() : newTransforms;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/direction.js
const getStreamDirection = (stdioItems, fdNumber, optionName) => {
	const directions = stdioItems.map((stdioItem) => getStdioItemDirection(stdioItem, fdNumber));
	if (directions.includes("input") && directions.includes("output")) throw new TypeError(`The \`${optionName}\` option must not be an array of both readable and writable values.`);
	return directions.find(Boolean) ?? DEFAULT_DIRECTION;
};
const getStdioItemDirection = ({ type, value }, fdNumber) => KNOWN_DIRECTIONS[fdNumber] ?? guessStreamDirection[type](value);
const KNOWN_DIRECTIONS = [
	"input",
	"output",
	"output"
];
const anyDirection = () => void 0;
const alwaysInput = () => "input";
const guessStreamDirection = {
	generator: anyDirection,
	asyncGenerator: anyDirection,
	fileUrl: anyDirection,
	filePath: anyDirection,
	iterable: alwaysInput,
	asyncIterable: alwaysInput,
	uint8Array: alwaysInput,
	webStream: (value) => isWritableStream(value) ? "output" : "input",
	nodeStream(value) {
		if (!isReadableStream$1(value, { checkOpen: false })) return "output";
		return isWritableStream$1(value, { checkOpen: false }) ? void 0 : "input";
	},
	webTransform: anyDirection,
	duplex: anyDirection,
	native(value) {
		const standardStreamDirection = getStandardStreamDirection(value);
		if (standardStreamDirection !== void 0) return standardStreamDirection;
		if (isStream(value, { checkOpen: false })) return guessStreamDirection.nodeStream(value);
	}
};
const getStandardStreamDirection = (value) => {
	if ([0, process$1.stdin].includes(value)) return "input";
	if ([
		1,
		2,
		process$1.stdout,
		process$1.stderr
	].includes(value)) return "output";
};
const DEFAULT_DIRECTION = "output";

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/array.js
const normalizeIpcStdioArray = (stdioArray, ipc) => ipc && !stdioArray.includes("ipc") ? [...stdioArray, "ipc"] : stdioArray;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/stdio-option.js
const normalizeStdioOption = ({ stdio, ipc, buffer, ...options }, verboseInfo, isSync) => {
	const stdioArray = getStdioArray(stdio, options).map((stdioOption, fdNumber) => addDefaultValue(stdioOption, fdNumber));
	return isSync ? normalizeStdioSync(stdioArray, buffer, verboseInfo) : normalizeIpcStdioArray(stdioArray, ipc);
};
const getStdioArray = (stdio, options) => {
	if (stdio === void 0) return STANDARD_STREAMS_ALIASES.map((alias) => options[alias]);
	if (hasAlias(options)) throw new Error(`It's not possible to provide \`stdio\` in combination with one of ${STANDARD_STREAMS_ALIASES.map((alias) => `\`${alias}\``).join(", ")}`);
	if (typeof stdio === "string") return [
		stdio,
		stdio,
		stdio
	];
	if (!Array.isArray(stdio)) throw new TypeError(`Expected \`stdio\` to be of type \`string\` or \`Array\`, got \`${typeof stdio}\``);
	const length = Math.max(stdio.length, STANDARD_STREAMS_ALIASES.length);
	return Array.from({ length }, (_, fdNumber) => stdio[fdNumber]);
};
const hasAlias = (options) => STANDARD_STREAMS_ALIASES.some((alias) => options[alias] !== void 0);
const addDefaultValue = (stdioOption, fdNumber) => {
	if (Array.isArray(stdioOption)) return stdioOption.map((item) => addDefaultValue(item, fdNumber));
	if (stdioOption === null || stdioOption === void 0) return fdNumber >= STANDARD_STREAMS_ALIASES.length ? "ignore" : "pipe";
	return stdioOption;
};
const normalizeStdioSync = (stdioArray, buffer, verboseInfo) => stdioArray.map((stdioOption, fdNumber) => !buffer[fdNumber] && fdNumber !== 0 && !isFullVerbose(verboseInfo, fdNumber) && isOutputPipeOnly(stdioOption) ? "ignore" : stdioOption);
const isOutputPipeOnly = (stdioOption) => stdioOption === "pipe" || Array.isArray(stdioOption) && stdioOption.every((item) => item === "pipe");

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/native.js
const handleNativeStream = ({ stdioItem, stdioItem: { type }, isStdioArray, fdNumber, direction, isSync }) => {
	if (!isStdioArray || type !== "native") return stdioItem;
	return isSync ? handleNativeStreamSync({
		stdioItem,
		fdNumber,
		direction
	}) : handleNativeStreamAsync({
		stdioItem,
		fdNumber
	});
};
const handleNativeStreamSync = ({ stdioItem, stdioItem: { value, optionName }, fdNumber, direction }) => {
	const targetFd = getTargetFd({
		value,
		optionName,
		fdNumber,
		direction
	});
	if (targetFd !== void 0) return targetFd;
	if (isStream(value, { checkOpen: false })) throw new TypeError(`The \`${optionName}: Stream\` option cannot both be an array and include a stream with synchronous methods.`);
	return stdioItem;
};
const getTargetFd = ({ value, optionName, fdNumber, direction }) => {
	const targetFdNumber = getTargetFdNumber(value, fdNumber);
	if (targetFdNumber === void 0) return;
	if (direction === "output") return {
		type: "fileNumber",
		value: targetFdNumber,
		optionName
	};
	if (tty.isatty(targetFdNumber)) throw new TypeError(`The \`${optionName}: ${serializeOptionValue(value)}\` option is invalid: it cannot be a TTY with synchronous methods.`);
	return {
		type: "uint8Array",
		value: bufferToUint8Array(readFileSync(targetFdNumber)),
		optionName
	};
};
const getTargetFdNumber = (value, fdNumber) => {
	if (value === "inherit") return fdNumber;
	if (typeof value === "number") return value;
	const standardStreamIndex = STANDARD_STREAMS.indexOf(value);
	if (standardStreamIndex !== -1) return standardStreamIndex;
};
const handleNativeStreamAsync = ({ stdioItem, stdioItem: { value, optionName }, fdNumber }) => {
	if (value === "inherit") return {
		type: "nodeStream",
		value: getStandardStream(fdNumber, value, optionName),
		optionName
	};
	if (typeof value === "number") return {
		type: "nodeStream",
		value: getStandardStream(value, value, optionName),
		optionName
	};
	if (isStream(value, { checkOpen: false })) return {
		type: "nodeStream",
		value,
		optionName
	};
	return stdioItem;
};
const getStandardStream = (fdNumber, value, optionName) => {
	const standardStream = STANDARD_STREAMS[fdNumber];
	if (standardStream === void 0) throw new TypeError(`The \`${optionName}: ${value}\` option is invalid: no such standard stream.`);
	return standardStream;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/input-option.js
const handleInputOptions = ({ input, inputFile }, fdNumber) => fdNumber === 0 ? [...handleInputOption(input), ...handleInputFileOption(inputFile)] : [];
const handleInputOption = (input) => input === void 0 ? [] : [{
	type: getInputType(input),
	value: input,
	optionName: "input"
}];
const getInputType = (input) => {
	if (isReadableStream$1(input, { checkOpen: false })) return "nodeStream";
	if (typeof input === "string") return "string";
	if (isUint8Array(input)) return "uint8Array";
	throw new Error("The `input` option must be a string, a Uint8Array or a Node.js Readable stream.");
};
const handleInputFileOption = (inputFile) => inputFile === void 0 ? [] : [{
	...getInputFileType(inputFile),
	optionName: "inputFile"
}];
const getInputFileType = (inputFile) => {
	if (isUrl(inputFile)) return {
		type: "fileUrl",
		value: inputFile
	};
	if (isFilePathString(inputFile)) return {
		type: "filePath",
		value: { file: inputFile }
	};
	throw new Error("The `inputFile` option must be a file path string or a file URL.");
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/duplicate.js
const filterDuplicates = (stdioItems) => stdioItems.filter((stdioItemOne, indexOne) => stdioItems.every((stdioItemTwo, indexTwo) => stdioItemOne.value !== stdioItemTwo.value || indexOne >= indexTwo || stdioItemOne.type === "generator" || stdioItemOne.type === "asyncGenerator"));
const getDuplicateStream = ({ stdioItem: { type, value, optionName }, direction, fileDescriptors, isSync }) => {
	const otherStdioItems = getOtherStdioItems(fileDescriptors, type);
	if (otherStdioItems.length === 0) return;
	if (isSync) {
		validateDuplicateStreamSync({
			otherStdioItems,
			type,
			value,
			optionName,
			direction
		});
		return;
	}
	if (SPECIAL_DUPLICATE_TYPES.has(type)) return getDuplicateStreamInstance({
		otherStdioItems,
		type,
		value,
		optionName,
		direction
	});
	if (FORBID_DUPLICATE_TYPES.has(type)) validateDuplicateTransform({
		otherStdioItems,
		type,
		value,
		optionName
	});
};
const getOtherStdioItems = (fileDescriptors, type) => fileDescriptors.flatMap(({ direction, stdioItems }) => stdioItems.filter((stdioItem) => stdioItem.type === type).map(((stdioItem) => ({
	...stdioItem,
	direction
}))));
const validateDuplicateStreamSync = ({ otherStdioItems, type, value, optionName, direction }) => {
	if (SPECIAL_DUPLICATE_TYPES_SYNC.has(type)) getDuplicateStreamInstance({
		otherStdioItems,
		type,
		value,
		optionName,
		direction
	});
};
const getDuplicateStreamInstance = ({ otherStdioItems, type, value, optionName, direction }) => {
	const duplicateStdioItems = otherStdioItems.filter((stdioItem) => hasSameValue(stdioItem, value));
	if (duplicateStdioItems.length === 0) return;
	const differentStdioItem = duplicateStdioItems.find((stdioItem) => stdioItem.direction !== direction);
	throwOnDuplicateStream(differentStdioItem, optionName, type);
	return direction === "output" ? duplicateStdioItems[0].stream : void 0;
};
const hasSameValue = ({ type, value }, secondValue) => {
	if (type === "filePath") return value.file === secondValue.file;
	if (type === "fileUrl") return value.href === secondValue.href;
	return value === secondValue;
};
const validateDuplicateTransform = ({ otherStdioItems, type, value, optionName }) => {
	const duplicateStdioItem = otherStdioItems.find(({ value: { transform } }) => transform === value.transform);
	throwOnDuplicateStream(duplicateStdioItem, optionName, type);
};
const throwOnDuplicateStream = (stdioItem, optionName, type) => {
	if (stdioItem !== void 0) throw new TypeError(`The \`${stdioItem.optionName}\` and \`${optionName}\` options must not target ${TYPE_TO_MESSAGE[type]} that is the same.`);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/handle.js
const handleStdio = (addProperties, options, verboseInfo, isSync) => {
	const initialFileDescriptors = normalizeStdioOption(options, verboseInfo, isSync).map((stdioOption, fdNumber) => getFileDescriptor({
		stdioOption,
		fdNumber,
		options,
		isSync
	}));
	const fileDescriptors = getFinalFileDescriptors({
		initialFileDescriptors,
		addProperties,
		options,
		isSync
	});
	options.stdio = fileDescriptors.map(({ stdioItems }) => forwardStdio(stdioItems));
	return fileDescriptors;
};
const getFileDescriptor = ({ stdioOption, fdNumber, options, isSync }) => {
	const optionName = getStreamName(fdNumber);
	const { stdioItems: initialStdioItems, isStdioArray } = initializeStdioItems({
		stdioOption,
		fdNumber,
		options,
		optionName
	});
	const direction = getStreamDirection(initialStdioItems, fdNumber, optionName);
	const normalizedStdioItems = normalizeTransforms(initialStdioItems.map((stdioItem) => handleNativeStream({
		stdioItem,
		isStdioArray,
		fdNumber,
		direction,
		isSync
	})), optionName, direction, options);
	const objectMode = getFdObjectMode(normalizedStdioItems, direction);
	validateFileObjectMode(normalizedStdioItems, objectMode);
	return {
		direction,
		objectMode,
		stdioItems: normalizedStdioItems
	};
};
const initializeStdioItems = ({ stdioOption, fdNumber, options, optionName }) => {
	const stdioItems = filterDuplicates([...(Array.isArray(stdioOption) ? stdioOption : [stdioOption]).map((value) => initializeStdioItem(value, optionName)), ...handleInputOptions(options, fdNumber)]);
	const isStdioArray = stdioItems.length > 1;
	validateStdioArray(stdioItems, isStdioArray, optionName);
	validateStreams(stdioItems);
	return {
		stdioItems,
		isStdioArray
	};
};
const initializeStdioItem = (value, optionName) => ({
	type: getStdioItemType(value, optionName),
	value,
	optionName
});
const validateStdioArray = (stdioItems, isStdioArray, optionName) => {
	if (stdioItems.length === 0) throw new TypeError(`The \`${optionName}\` option must not be an empty array.`);
	if (!isStdioArray) return;
	for (const { value, optionName } of stdioItems) if (INVALID_STDIO_ARRAY_OPTIONS.has(value)) throw new Error(`The \`${optionName}\` option must not include \`${value}\`.`);
};
const INVALID_STDIO_ARRAY_OPTIONS = /* @__PURE__ */ new Set(["ignore", "ipc"]);
const validateStreams = (stdioItems) => {
	for (const stdioItem of stdioItems) validateFileStdio(stdioItem);
};
const validateFileStdio = ({ type, value, optionName }) => {
	if (isRegularUrl(value)) throw new TypeError(`The \`${optionName}: URL\` option must use the \`file:\` scheme.
For example, you can use the \`pathToFileURL()\` method of the \`url\` core module.`);
	if (isUnknownStdioString(type, value)) throw new TypeError(`The \`${optionName}: { file: '...' }\` option must be used instead of \`${optionName}: '...'\`.`);
};
const validateFileObjectMode = (stdioItems, objectMode) => {
	if (!objectMode) return;
	const fileStdioItem = stdioItems.find(({ type }) => FILE_TYPES.has(type));
	if (fileStdioItem !== void 0) throw new TypeError(`The \`${fileStdioItem.optionName}\` option cannot use both files and transforms in objectMode.`);
};
const getFinalFileDescriptors = ({ initialFileDescriptors, addProperties, options, isSync }) => {
	const fileDescriptors = [];
	try {
		for (const fileDescriptor of initialFileDescriptors) fileDescriptors.push(getFinalFileDescriptor({
			fileDescriptor,
			fileDescriptors,
			addProperties,
			options,
			isSync
		}));
		return fileDescriptors;
	} catch (error) {
		cleanupCustomStreams(fileDescriptors);
		throw error;
	}
};
const getFinalFileDescriptor = ({ fileDescriptor: { direction, objectMode, stdioItems }, fileDescriptors, addProperties, options, isSync }) => {
	return {
		direction,
		objectMode,
		stdioItems: stdioItems.map((stdioItem) => addStreamProperties({
			stdioItem,
			addProperties,
			direction,
			options,
			fileDescriptors,
			isSync
		}))
	};
};
const addStreamProperties = ({ stdioItem, addProperties, direction, options, fileDescriptors, isSync }) => {
	const duplicateStream = getDuplicateStream({
		stdioItem,
		direction,
		fileDescriptors,
		isSync
	});
	if (duplicateStream !== void 0) return {
		...stdioItem,
		stream: duplicateStream
	};
	return {
		...stdioItem,
		...addProperties[direction][stdioItem.type](stdioItem, options)
	};
};
const cleanupCustomStreams = (fileDescriptors) => {
	for (const { stdioItems } of fileDescriptors) for (const { stream } of stdioItems) if (stream !== void 0 && !isStandardStream(stream)) stream.destroy();
};
const forwardStdio = (stdioItems) => {
	if (stdioItems.length > 1) return stdioItems.some(({ value }) => value === "overlapped") ? "overlapped" : "pipe";
	const [{ type, value }] = stdioItems;
	return type === "native" ? value : "pipe";
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/handle-sync.js
const handleStdioSync = (options, verboseInfo) => handleStdio(addPropertiesSync, options, verboseInfo, true);
const forbiddenIfSync = ({ type, optionName }) => {
	throwInvalidSyncValue(optionName, TYPE_TO_MESSAGE[type]);
};
const forbiddenNativeIfSync = ({ optionName, value }) => {
	if (value === "ipc" || value === "overlapped") throwInvalidSyncValue(optionName, `"${value}"`);
	return {};
};
const throwInvalidSyncValue = (optionName, value) => {
	throw new TypeError(`The \`${optionName}\` option cannot be ${value} with synchronous methods.`);
};
const addProperties$1 = {
	generator() {},
	asyncGenerator: forbiddenIfSync,
	webStream: forbiddenIfSync,
	nodeStream: forbiddenIfSync,
	webTransform: forbiddenIfSync,
	duplex: forbiddenIfSync,
	asyncIterable: forbiddenIfSync,
	native: forbiddenNativeIfSync
};
const addPropertiesSync = {
	input: {
		...addProperties$1,
		fileUrl: ({ value }) => ({ contents: [bufferToUint8Array(readFileSync(value))] }),
		filePath: ({ value: { file } }) => ({ contents: [bufferToUint8Array(readFileSync(file))] }),
		fileNumber: forbiddenIfSync,
		iterable: ({ value }) => ({ contents: [...value] }),
		string: ({ value }) => ({ contents: [value] }),
		uint8Array: ({ value }) => ({ contents: [value] })
	},
	output: {
		...addProperties$1,
		fileUrl: ({ value }) => ({ path: value }),
		filePath: ({ value: { file, append } }) => ({
			path: file,
			append
		}),
		fileNumber: ({ value }) => ({ path: value }),
		iterable: forbiddenIfSync,
		string: forbiddenIfSync,
		uint8Array: forbiddenIfSync
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/strip-newline.js
const stripNewline = (value, { stripFinalNewline: stripFinalNewline$1 }, fdNumber) => getStripFinalNewline(stripFinalNewline$1, fdNumber) && value !== void 0 && !Array.isArray(value) ? stripFinalNewline(value) : value;
const getStripFinalNewline = (stripFinalNewline, fdNumber) => fdNumber === "all" ? stripFinalNewline[1] || stripFinalNewline[2] : stripFinalNewline[fdNumber];

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/split.js
const getSplitLinesGenerator = (binary, preserveNewlines, skipped, state) => binary || skipped ? void 0 : initializeSplitLines(preserveNewlines, state);
const splitLinesSync = (chunk, preserveNewlines, objectMode) => objectMode ? chunk.flatMap((item) => splitLinesItemSync(item, preserveNewlines)) : splitLinesItemSync(chunk, preserveNewlines);
const splitLinesItemSync = (chunk, preserveNewlines) => {
	const { transform, final } = initializeSplitLines(preserveNewlines, {});
	return [...transform(chunk), ...final()];
};
const initializeSplitLines = (preserveNewlines, state) => {
	state.previousChunks = "";
	return {
		transform: splitGenerator.bind(void 0, state, preserveNewlines),
		final: linesFinal.bind(void 0, state)
	};
};
const splitGenerator = function* (state, preserveNewlines, chunk) {
	if (typeof chunk !== "string") {
		yield chunk;
		return;
	}
	let { previousChunks } = state;
	let start = -1;
	for (let end = 0; end < chunk.length; end += 1) if (chunk[end] === "\n") {
		const newlineLength = getNewlineLength(chunk, end, preserveNewlines, state);
		let line = chunk.slice(start + 1, end + 1 - newlineLength);
		if (previousChunks.length > 0) {
			line = concatString(previousChunks, line);
			previousChunks = "";
		}
		yield line;
		start = end;
	}
	if (start !== chunk.length - 1) previousChunks = concatString(previousChunks, chunk.slice(start + 1));
	state.previousChunks = previousChunks;
};
const getNewlineLength = (chunk, end, preserveNewlines, state) => {
	if (preserveNewlines) return 0;
	state.isWindowsNewline = end !== 0 && chunk[end - 1] === "\r";
	return state.isWindowsNewline ? 2 : 1;
};
const linesFinal = function* ({ previousChunks }) {
	if (previousChunks.length > 0) yield previousChunks;
};
const getAppendNewlineGenerator = ({ binary, preserveNewlines, readableObjectMode, state }) => binary || preserveNewlines || readableObjectMode ? void 0 : { transform: appendNewlineGenerator.bind(void 0, state) };
const appendNewlineGenerator = function* ({ isWindowsNewline = false }, chunk) {
	const { unixNewline, windowsNewline, LF, concatBytes } = typeof chunk === "string" ? linesStringInfo : linesUint8ArrayInfo;
	if (chunk.at(-1) === LF) {
		yield chunk;
		return;
	}
	yield concatBytes(chunk, isWindowsNewline ? windowsNewline : unixNewline);
};
const concatString = (firstChunk, secondChunk) => `${firstChunk}${secondChunk}`;
const linesStringInfo = {
	windowsNewline: "\r\n",
	unixNewline: "\n",
	LF: "\n",
	concatBytes: concatString
};
const concatUint8Array = (firstChunk, secondChunk) => {
	const chunk = new Uint8Array(firstChunk.length + secondChunk.length);
	chunk.set(firstChunk, 0);
	chunk.set(secondChunk, firstChunk.length);
	return chunk;
};
const linesUint8ArrayInfo = {
	windowsNewline: new Uint8Array([13, 10]),
	unixNewline: new Uint8Array([10]),
	LF: 10,
	concatBytes: concatUint8Array
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/validate.js
const getValidateTransformInput = (writableObjectMode, optionName) => writableObjectMode ? void 0 : validateStringTransformInput.bind(void 0, optionName);
const validateStringTransformInput = function* (optionName, chunk) {
	if (typeof chunk !== "string" && !isUint8Array(chunk) && !Buffer$1.isBuffer(chunk)) throw new TypeError(`The \`${optionName}\` option's transform must use "objectMode: true" to receive as input: ${typeof chunk}.`);
	yield chunk;
};
const getValidateTransformReturn = (readableObjectMode, optionName) => readableObjectMode ? validateObjectTransformReturn.bind(void 0, optionName) : validateStringTransformReturn.bind(void 0, optionName);
const validateObjectTransformReturn = function* (optionName, chunk) {
	validateEmptyReturn(optionName, chunk);
	yield chunk;
};
const validateStringTransformReturn = function* (optionName, chunk) {
	validateEmptyReturn(optionName, chunk);
	if (typeof chunk !== "string" && !isUint8Array(chunk)) throw new TypeError(`The \`${optionName}\` option's function must yield a string or an Uint8Array, not ${typeof chunk}.`);
	yield chunk;
};
const validateEmptyReturn = (optionName, chunk) => {
	if (chunk === null || chunk === void 0) throw new TypeError(`The \`${optionName}\` option's function must not call \`yield ${chunk}\`.
Instead, \`yield\` should either be called with a value, or not be called at all. For example:
  if (condition) { yield value; }`);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/encoding-transform.js
const getEncodingTransformGenerator = (binary, encoding, skipped) => {
	if (skipped) return;
	if (binary) return { transform: encodingUint8ArrayGenerator.bind(void 0, new TextEncoder()) };
	const stringDecoder = new StringDecoder(encoding);
	return {
		transform: encodingStringGenerator.bind(void 0, stringDecoder),
		final: encodingStringFinal.bind(void 0, stringDecoder)
	};
};
const encodingUint8ArrayGenerator = function* (textEncoder, chunk) {
	if (Buffer$1.isBuffer(chunk)) yield bufferToUint8Array(chunk);
	else if (typeof chunk === "string") yield textEncoder.encode(chunk);
	else yield chunk;
};
const encodingStringGenerator = function* (stringDecoder, chunk) {
	yield isUint8Array(chunk) ? stringDecoder.write(chunk) : chunk;
};
const encodingStringFinal = function* (stringDecoder) {
	const lastChunk = stringDecoder.end();
	if (lastChunk !== "") yield lastChunk;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/run-async.js
const pushChunks = callbackify(async (getChunks, state, getChunksArguments, transformStream) => {
	state.currentIterable = getChunks(...getChunksArguments);
	try {
		for await (const chunk of state.currentIterable) transformStream.push(chunk);
	} finally {
		delete state.currentIterable;
	}
});
const transformChunk = async function* (chunk, generators, index) {
	if (index === generators.length) {
		yield chunk;
		return;
	}
	const { transform = identityGenerator$1 } = generators[index];
	for await (const transformedChunk of transform(chunk)) yield* transformChunk(transformedChunk, generators, index + 1);
};
const finalChunks = async function* (generators) {
	for (const [index, { final }] of Object.entries(generators)) yield* generatorFinalChunks(final, Number(index), generators);
};
const generatorFinalChunks = async function* (final, index, generators) {
	if (final === void 0) return;
	for await (const finalChunk of final()) yield* transformChunk(finalChunk, generators, index + 1);
};
const destroyTransform = callbackify(async ({ currentIterable }, error) => {
	if (currentIterable !== void 0) {
		await (error ? currentIterable.throw(error) : currentIterable.return());
		return;
	}
	if (error) throw error;
});
const identityGenerator$1 = function* (chunk) {
	yield chunk;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/run-sync.js
const pushChunksSync = (getChunksSync, getChunksArguments, transformStream, done) => {
	try {
		for (const chunk of getChunksSync(...getChunksArguments)) transformStream.push(chunk);
		done();
	} catch (error) {
		done(error);
	}
};
const runTransformSync = (generators, chunks) => [...chunks.flatMap((chunk) => [...transformChunkSync(chunk, generators, 0)]), ...finalChunksSync(generators)];
const transformChunkSync = function* (chunk, generators, index) {
	if (index === generators.length) {
		yield chunk;
		return;
	}
	const { transform = identityGenerator } = generators[index];
	for (const transformedChunk of transform(chunk)) yield* transformChunkSync(transformedChunk, generators, index + 1);
};
const finalChunksSync = function* (generators) {
	for (const [index, { final }] of Object.entries(generators)) yield* generatorFinalChunksSync(final, Number(index), generators);
};
const generatorFinalChunksSync = function* (final, index, generators) {
	if (final === void 0) return;
	for (const finalChunk of final()) yield* transformChunkSync(finalChunk, generators, index + 1);
};
const identityGenerator = function* (chunk) {
	yield chunk;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/transform/generator.js
const generatorToStream = ({ value, value: { transform, final, writableObjectMode, readableObjectMode }, optionName }, { encoding }) => {
	const state = {};
	const generators = addInternalGenerators(value, encoding, optionName);
	const transformAsync = isAsyncGenerator(transform);
	const finalAsync = isAsyncGenerator(final);
	const transformMethod = transformAsync ? pushChunks.bind(void 0, transformChunk, state) : pushChunksSync.bind(void 0, transformChunkSync);
	const finalMethod = transformAsync || finalAsync ? pushChunks.bind(void 0, finalChunks, state) : pushChunksSync.bind(void 0, finalChunksSync);
	const destroyMethod = transformAsync || finalAsync ? destroyTransform.bind(void 0, state) : void 0;
	return { stream: new Transform({
		writableObjectMode,
		writableHighWaterMark: getDefaultHighWaterMark(writableObjectMode),
		readableObjectMode,
		readableHighWaterMark: getDefaultHighWaterMark(readableObjectMode),
		transform(chunk, encoding, done) {
			transformMethod([
				chunk,
				generators,
				0
			], this, done);
		},
		flush(done) {
			finalMethod([generators], this, done);
		},
		destroy: destroyMethod
	}) };
};
const runGeneratorsSync = (chunks, stdioItems, encoding, isInput) => {
	const generators = stdioItems.filter(({ type }) => type === "generator");
	const reversedGenerators = isInput ? generators.reverse() : generators;
	for (const { value, optionName } of reversedGenerators) chunks = runTransformSync(addInternalGenerators(value, encoding, optionName), chunks);
	return chunks;
};
const addInternalGenerators = ({ transform, final, binary, writableObjectMode, readableObjectMode, preserveNewlines }, encoding, optionName) => {
	const state = {};
	return [
		{ transform: getValidateTransformInput(writableObjectMode, optionName) },
		getEncodingTransformGenerator(binary, encoding, writableObjectMode),
		getSplitLinesGenerator(binary, preserveNewlines, writableObjectMode, state),
		{
			transform,
			final
		},
		{ transform: getValidateTransformReturn(readableObjectMode, optionName) },
		getAppendNewlineGenerator({
			binary,
			preserveNewlines,
			readableObjectMode,
			state
		})
	].filter(Boolean);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/input-sync.js
const addInputOptionsSync = (fileDescriptors, options) => {
	for (const fdNumber of getInputFdNumbers(fileDescriptors)) addInputOptionSync(fileDescriptors, fdNumber, options);
};
const getInputFdNumbers = (fileDescriptors) => new Set(Object.entries(fileDescriptors).filter(([, { direction }]) => direction === "input").map(([fdNumber]) => Number(fdNumber)));
const addInputOptionSync = (fileDescriptors, fdNumber, options) => {
	const { stdioItems } = fileDescriptors[fdNumber];
	const allStdioItems = stdioItems.filter(({ contents }) => contents !== void 0);
	if (allStdioItems.length === 0) return;
	if (fdNumber !== 0) {
		const [{ type, optionName }] = allStdioItems;
		throw new TypeError(`Only the \`stdin\` option, not \`${optionName}\`, can be ${TYPE_TO_MESSAGE[type]} with synchronous methods.`);
	}
	options.input = joinToUint8Array(allStdioItems.map(({ contents }) => contents).map((contents) => applySingleInputGeneratorsSync(contents, stdioItems)));
};
const applySingleInputGeneratorsSync = (contents, stdioItems) => {
	const newContents = runGeneratorsSync(contents, stdioItems, "utf8", true);
	validateSerializable(newContents);
	return joinToUint8Array(newContents);
};
const validateSerializable = (newContents) => {
	const invalidItem = newContents.find((item) => typeof item !== "string" && !isUint8Array(item));
	if (invalidItem !== void 0) throw new TypeError(`The \`stdin\` option is invalid: when passing objects as input, a transform must be used to serialize them to strings or Uint8Arrays: ${invalidItem}.`);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/output.js
const shouldLogOutput = ({ stdioItems, encoding, verboseInfo, fdNumber }) => fdNumber !== "all" && isFullVerbose(verboseInfo, fdNumber) && !BINARY_ENCODINGS.has(encoding) && fdUsesVerbose(fdNumber) && (stdioItems.some(({ type, value }) => type === "native" && PIPED_STDIO_VALUES.has(value)) || stdioItems.every(({ type }) => TRANSFORM_TYPES.has(type)));
const fdUsesVerbose = (fdNumber) => fdNumber === 1 || fdNumber === 2;
const PIPED_STDIO_VALUES = /* @__PURE__ */ new Set(["pipe", "overlapped"]);
const logLines = async (linesIterable, stream, fdNumber, verboseInfo) => {
	for await (const line of linesIterable) if (!isPipingStream(stream)) logLine(line, fdNumber, verboseInfo);
};
const logLinesSync = (linesArray, fdNumber, verboseInfo) => {
	for (const line of linesArray) logLine(line, fdNumber, verboseInfo);
};
const isPipingStream = (stream) => stream._readableState.pipes.length > 0;
const logLine = (line, fdNumber, verboseInfo) => {
	verboseLog({
		type: "output",
		verboseMessage: serializeVerboseMessage(line),
		fdNumber,
		verboseInfo
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/output-sync.js
const transformOutputSync = ({ fileDescriptors, syncResult: { output }, options, isMaxBuffer, verboseInfo }) => {
	if (output === null) return { output: Array.from({ length: 3 }) };
	const state = {};
	const outputFiles = /* @__PURE__ */ new Set([]);
	return {
		output: output.map((result, fdNumber) => transformOutputResultSync({
			result,
			fileDescriptors,
			fdNumber,
			state,
			outputFiles,
			isMaxBuffer,
			verboseInfo
		}, options)),
		...state
	};
};
const transformOutputResultSync = ({ result, fileDescriptors, fdNumber, state, outputFiles, isMaxBuffer, verboseInfo }, { buffer, encoding, lines, stripFinalNewline, maxBuffer }) => {
	if (result === null) return;
	const uint8ArrayResult = bufferToUint8Array(truncateMaxBufferSync(result, isMaxBuffer, maxBuffer));
	const { stdioItems, objectMode } = fileDescriptors[fdNumber];
	const chunks = runOutputGeneratorsSync([uint8ArrayResult], stdioItems, encoding, state);
	const { serializedResult, finalResult = serializedResult } = serializeChunks({
		chunks,
		objectMode,
		encoding,
		lines,
		stripFinalNewline,
		fdNumber
	});
	logOutputSync({
		serializedResult,
		fdNumber,
		state,
		verboseInfo,
		encoding,
		stdioItems,
		objectMode
	});
	const returnedResult = buffer[fdNumber] ? finalResult : void 0;
	try {
		if (state.error === void 0) writeToFiles(serializedResult, stdioItems, outputFiles);
		return returnedResult;
	} catch (error) {
		state.error = error;
		return returnedResult;
	}
};
const runOutputGeneratorsSync = (chunks, stdioItems, encoding, state) => {
	try {
		return runGeneratorsSync(chunks, stdioItems, encoding, false);
	} catch (error) {
		state.error = error;
		return chunks;
	}
};
const serializeChunks = ({ chunks, objectMode, encoding, lines, stripFinalNewline, fdNumber }) => {
	if (objectMode) return { serializedResult: chunks };
	if (encoding === "buffer") return { serializedResult: joinToUint8Array(chunks) };
	const serializedResult = joinToString(chunks, encoding);
	if (lines[fdNumber]) return {
		serializedResult,
		finalResult: splitLinesSync(serializedResult, !stripFinalNewline[fdNumber], objectMode)
	};
	return { serializedResult };
};
const logOutputSync = ({ serializedResult, fdNumber, state, verboseInfo, encoding, stdioItems, objectMode }) => {
	if (!shouldLogOutput({
		stdioItems,
		encoding,
		verboseInfo,
		fdNumber
	})) return;
	const linesArray = splitLinesSync(serializedResult, false, objectMode);
	try {
		logLinesSync(linesArray, fdNumber, verboseInfo);
	} catch (error) {
		state.error ??= error;
	}
};
const writeToFiles = (serializedResult, stdioItems, outputFiles) => {
	for (const { path, append } of stdioItems.filter(({ type }) => FILE_TYPES.has(type))) {
		const pathString = typeof path === "string" ? path : path.toString();
		if (append || outputFiles.has(pathString)) appendFileSync(path, serializedResult);
		else {
			outputFiles.add(pathString);
			writeFileSync(path, serializedResult);
		}
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/all-sync.js
const getAllSync = ([, stdout, stderr], options) => {
	if (!options.all) return;
	if (stdout === void 0) return stderr;
	if (stderr === void 0) return stdout;
	if (Array.isArray(stdout)) return Array.isArray(stderr) ? [...stdout, ...stderr] : [...stdout, stripNewline(stderr, options, "all")];
	if (Array.isArray(stderr)) return [stripNewline(stdout, options, "all"), ...stderr];
	if (isUint8Array(stdout) && isUint8Array(stderr)) return concatUint8Arrays([stdout, stderr]);
	return `${stdout}${stderr}`;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/exit-async.js
const waitForExit = async (subprocess, context) => {
	const [exitCode, signal] = await waitForExitOrError(subprocess);
	context.isForcefullyTerminated ??= false;
	return [exitCode, signal];
};
const waitForExitOrError = async (subprocess) => {
	const [spawnPayload, exitPayload] = await Promise.allSettled([once(subprocess, "spawn"), once(subprocess, "exit")]);
	if (spawnPayload.status === "rejected") return [];
	return exitPayload.status === "rejected" ? waitForSubprocessExit(subprocess) : exitPayload.value;
};
const waitForSubprocessExit = async (subprocess) => {
	try {
		return await once(subprocess, "exit");
	} catch {
		return waitForSubprocessExit(subprocess);
	}
};
const waitForSuccessfulExit = async (exitPromise) => {
	const [exitCode, signal] = await exitPromise;
	if (!isSubprocessErrorExit(exitCode, signal) && isFailedExit(exitCode, signal)) throw new DiscardedError();
	return [exitCode, signal];
};
const isSubprocessErrorExit = (exitCode, signal) => exitCode === void 0 && signal === void 0;
const isFailedExit = (exitCode, signal) => exitCode !== 0 || signal !== null;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/exit-sync.js
const getExitResultSync = ({ error, status: exitCode, signal, output }, { maxBuffer }) => {
	const resultError = getResultError(error, exitCode, signal);
	return {
		resultError,
		exitCode,
		signal,
		timedOut: resultError?.code === "ETIMEDOUT",
		isMaxBuffer: isMaxBufferSync(resultError, output, maxBuffer)
	};
};
const getResultError = (error, exitCode, signal) => {
	if (error !== void 0) return error;
	return isFailedExit(exitCode, signal) ? new DiscardedError() : void 0;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/main-sync.js
const execaCoreSync = (rawFile, rawArguments, rawOptions) => {
	const { file, commandArguments, command, escapedCommand, startTime, verboseInfo, options, fileDescriptors } = handleSyncArguments(rawFile, rawArguments, rawOptions);
	return handleResult(spawnSubprocessSync({
		file,
		commandArguments,
		options,
		command,
		escapedCommand,
		verboseInfo,
		fileDescriptors,
		startTime
	}), verboseInfo, options);
};
const handleSyncArguments = (rawFile, rawArguments, rawOptions) => {
	const { command, escapedCommand, startTime, verboseInfo } = handleCommand(rawFile, rawArguments, rawOptions);
	const { file, commandArguments, options } = normalizeOptions(rawFile, rawArguments, normalizeSyncOptions(rawOptions));
	validateSyncOptions(options);
	return {
		file,
		commandArguments,
		command,
		escapedCommand,
		startTime,
		verboseInfo,
		options,
		fileDescriptors: handleStdioSync(options, verboseInfo)
	};
};
const normalizeSyncOptions = (options) => options.node && !options.ipc ? {
	...options,
	ipc: false
} : options;
const validateSyncOptions = ({ ipc, ipcInput, detached, cancelSignal }) => {
	if (ipcInput) throwInvalidSyncOption("ipcInput");
	if (ipc) throwInvalidSyncOption("ipc: true");
	if (detached) throwInvalidSyncOption("detached: true");
	if (cancelSignal) throwInvalidSyncOption("cancelSignal");
};
const throwInvalidSyncOption = (value) => {
	throw new TypeError(`The "${value}" option cannot be used with synchronous methods.`);
};
const spawnSubprocessSync = ({ file, commandArguments, options, command, escapedCommand, verboseInfo, fileDescriptors, startTime }) => {
	const syncResult = runSubprocessSync({
		file,
		commandArguments,
		options,
		command,
		escapedCommand,
		fileDescriptors,
		startTime
	});
	if (syncResult.failed) return syncResult;
	const { resultError, exitCode, signal, timedOut, isMaxBuffer } = getExitResultSync(syncResult, options);
	const { output, error = resultError } = transformOutputSync({
		fileDescriptors,
		syncResult,
		options,
		isMaxBuffer,
		verboseInfo
	});
	const stdio = output.map((stdioOutput, fdNumber) => stripNewline(stdioOutput, options, fdNumber));
	const all = stripNewline(getAllSync(output, options), options, "all");
	return getSyncResult({
		error,
		exitCode,
		signal,
		timedOut,
		isMaxBuffer,
		stdio,
		all,
		options,
		command,
		escapedCommand,
		startTime
	});
};
const runSubprocessSync = ({ file, commandArguments, options, command, escapedCommand, fileDescriptors, startTime }) => {
	try {
		addInputOptionsSync(fileDescriptors, options);
		return spawnSync(...concatenateShell(file, commandArguments, normalizeSpawnSyncOptions(options)));
	} catch (error) {
		return makeEarlyError({
			error,
			command,
			escapedCommand,
			fileDescriptors,
			options,
			startTime,
			isSync: true
		});
	}
};
const normalizeSpawnSyncOptions = ({ encoding, maxBuffer, ...options }) => ({
	...options,
	encoding: "buffer",
	maxBuffer: getMaxBufferSync(maxBuffer)
});
const getSyncResult = ({ error, exitCode, signal, timedOut, isMaxBuffer, stdio, all, options, command, escapedCommand, startTime }) => error === void 0 ? makeSuccessResult({
	command,
	escapedCommand,
	stdio,
	all,
	ipcOutput: [],
	options,
	startTime
}) : makeError({
	error,
	command,
	escapedCommand,
	timedOut,
	isCanceled: false,
	isGracefullyCanceled: false,
	isMaxBuffer,
	isForcefullyTerminated: false,
	exitCode,
	signal,
	stdio,
	all,
	ipcOutput: [],
	options,
	startTime,
	isSync: true
});

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/get-one.js
const getOneMessage$1 = ({ anyProcess, channel, isSubprocess, ipc }, { reference = true, filter } = {}) => {
	validateIpcMethod({
		methodName: "getOneMessage",
		isSubprocess,
		ipc,
		isConnected: isConnected(anyProcess)
	});
	return getOneMessageAsync({
		anyProcess,
		channel,
		isSubprocess,
		filter,
		reference
	});
};
const getOneMessageAsync = async ({ anyProcess, channel, isSubprocess, filter, reference }) => {
	addReference(channel, reference);
	const ipcEmitter = getIpcEmitter(anyProcess, channel, isSubprocess);
	const controller = new AbortController();
	try {
		return await Promise.race([
			getMessage(ipcEmitter, filter, controller),
			throwOnDisconnect(ipcEmitter, isSubprocess, controller),
			throwOnStrictError(ipcEmitter, isSubprocess, controller)
		]);
	} catch (error) {
		disconnect(anyProcess);
		throw error;
	} finally {
		controller.abort();
		removeReference(channel, reference);
	}
};
const getMessage = async (ipcEmitter, filter, { signal }) => {
	if (filter === void 0) {
		const [message] = await once(ipcEmitter, "message", { signal });
		return message;
	}
	for await (const [message] of on(ipcEmitter, "message", { signal })) if (filter(message)) return message;
};
const throwOnDisconnect = async (ipcEmitter, isSubprocess, { signal }) => {
	await once(ipcEmitter, "disconnect", { signal });
	throwOnEarlyDisconnect(isSubprocess);
};
const throwOnStrictError = async (ipcEmitter, isSubprocess, { signal }) => {
	const [error] = await once(ipcEmitter, "strict:error", { signal });
	throw getStrictResponseError(error, isSubprocess);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/get-each.js
const getEachMessage$1 = ({ anyProcess, channel, isSubprocess, ipc }, { reference = true } = {}) => loopOnMessages({
	anyProcess,
	channel,
	isSubprocess,
	ipc,
	shouldAwait: !isSubprocess,
	reference
});
const loopOnMessages = ({ anyProcess, channel, isSubprocess, ipc, shouldAwait, reference }) => {
	validateIpcMethod({
		methodName: "getEachMessage",
		isSubprocess,
		ipc,
		isConnected: isConnected(anyProcess)
	});
	addReference(channel, reference);
	const ipcEmitter = getIpcEmitter(anyProcess, channel, isSubprocess);
	const controller = new AbortController();
	const state = {};
	stopOnDisconnect(anyProcess, ipcEmitter, controller);
	abortOnStrictError({
		ipcEmitter,
		isSubprocess,
		controller,
		state
	});
	return iterateOnMessages({
		anyProcess,
		channel,
		ipcEmitter,
		isSubprocess,
		shouldAwait,
		controller,
		state,
		reference
	});
};
const stopOnDisconnect = async (anyProcess, ipcEmitter, controller) => {
	try {
		await once(ipcEmitter, "disconnect", { signal: controller.signal });
		controller.abort();
	} catch {}
};
const abortOnStrictError = async ({ ipcEmitter, isSubprocess, controller, state }) => {
	try {
		const [error] = await once(ipcEmitter, "strict:error", { signal: controller.signal });
		state.error = getStrictResponseError(error, isSubprocess);
		controller.abort();
	} catch {}
};
const iterateOnMessages = async function* ({ anyProcess, channel, ipcEmitter, isSubprocess, shouldAwait, controller, state, reference }) {
	try {
		for await (const [message] of on(ipcEmitter, "message", { signal: controller.signal })) {
			throwIfStrictError(state);
			yield message;
		}
	} catch {
		throwIfStrictError(state);
	} finally {
		controller.abort();
		removeReference(channel, reference);
		if (!isSubprocess) disconnect(anyProcess);
		if (shouldAwait) await anyProcess;
	}
};
const throwIfStrictError = ({ error }) => {
	if (error) throw error;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/methods.js
const addIpcMethods = (subprocess, { ipc }) => {
	Object.assign(subprocess, getIpcMethods(subprocess, false, ipc));
};
const getIpcExport = () => {
	const anyProcess = process$1;
	const isSubprocess = true;
	const ipc = process$1.channel !== void 0;
	return {
		...getIpcMethods(anyProcess, isSubprocess, ipc),
		getCancelSignal: getCancelSignal$1.bind(void 0, {
			anyProcess,
			channel: anyProcess.channel,
			isSubprocess,
			ipc
		})
	};
};
const getIpcMethods = (anyProcess, isSubprocess, ipc) => ({
	sendMessage: sendMessage$1.bind(void 0, {
		anyProcess,
		channel: anyProcess.channel,
		isSubprocess,
		ipc
	}),
	getOneMessage: getOneMessage$1.bind(void 0, {
		anyProcess,
		channel: anyProcess.channel,
		isSubprocess,
		ipc
	}),
	getEachMessage: getEachMessage$1.bind(void 0, {
		anyProcess,
		channel: anyProcess.channel,
		isSubprocess,
		ipc
	})
});

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/return/early-error.js
const handleEarlyError = ({ error, command, escapedCommand, fileDescriptors, options, startTime, verboseInfo }) => {
	cleanupCustomStreams(fileDescriptors);
	const subprocess = new ChildProcess();
	createDummyStreams(subprocess, fileDescriptors);
	Object.assign(subprocess, {
		readable,
		writable,
		duplex
	});
	const earlyError = makeEarlyError({
		error,
		command,
		escapedCommand,
		fileDescriptors,
		options,
		startTime,
		isSync: false
	});
	return {
		subprocess,
		promise: handleDummyPromise(earlyError, verboseInfo, options)
	};
};
const createDummyStreams = (subprocess, fileDescriptors) => {
	const stdin = createDummyStream();
	const stdout = createDummyStream();
	const stderr = createDummyStream();
	const extraStdio = Array.from({ length: fileDescriptors.length - 3 }, createDummyStream);
	const all = createDummyStream();
	const stdio = [
		stdin,
		stdout,
		stderr,
		...extraStdio
	];
	Object.assign(subprocess, {
		stdin,
		stdout,
		stderr,
		all,
		stdio
	});
};
const createDummyStream = () => {
	const stream = new PassThrough();
	stream.end();
	return stream;
};
const readable = () => new Readable({ read() {} });
const writable = () => new Writable({ write() {} });
const duplex = () => new Duplex({
	read() {},
	write() {}
});
const handleDummyPromise = async (error, verboseInfo, options) => handleResult(error, verboseInfo, options);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/stdio/handle-async.js
const handleStdioAsync = (options, verboseInfo) => handleStdio(addPropertiesAsync, options, verboseInfo, false);
const forbiddenIfAsync = ({ type, optionName }) => {
	throw new TypeError(`The \`${optionName}\` option cannot be ${TYPE_TO_MESSAGE[type]}.`);
};
const addProperties = {
	fileNumber: forbiddenIfAsync,
	generator: generatorToStream,
	asyncGenerator: generatorToStream,
	nodeStream: ({ value }) => ({ stream: value }),
	webTransform({ value: { transform, writableObjectMode, readableObjectMode } }) {
		const objectMode = writableObjectMode || readableObjectMode;
		return { stream: Duplex.fromWeb(transform, { objectMode }) };
	},
	duplex: ({ value: { transform } }) => ({ stream: transform }),
	native() {}
};
const addPropertiesAsync = {
	input: {
		...addProperties,
		fileUrl: ({ value }) => ({ stream: createReadStream(value) }),
		filePath: ({ value: { file } }) => ({ stream: createReadStream(file) }),
		webStream: ({ value }) => ({ stream: Readable.fromWeb(value) }),
		iterable: ({ value }) => ({ stream: Readable.from(value) }),
		asyncIterable: ({ value }) => ({ stream: Readable.from(value) }),
		string: ({ value }) => ({ stream: Readable.from(value) }),
		uint8Array: ({ value }) => ({ stream: Readable.from(Buffer$1.from(value)) })
	},
	output: {
		...addProperties,
		fileUrl: ({ value }) => ({ stream: createWriteStream(value) }),
		filePath: ({ value: { file, append } }) => ({ stream: createWriteStream(file, append ? { flags: "a" } : {}) }),
		webStream: ({ value }) => ({ stream: Writable.fromWeb(value) }),
		iterable: forbiddenIfAsync,
		asyncIterable: forbiddenIfAsync,
		string: forbiddenIfAsync,
		uint8Array: forbiddenIfAsync
	}
};

//#endregion
//#region ../../node_modules/.pnpm/@sindresorhus+merge-streams@4.0.0/node_modules/@sindresorhus/merge-streams/index.js
function mergeStreams(streams) {
	if (!Array.isArray(streams)) throw new TypeError(`Expected an array, got \`${typeof streams}\`.`);
	for (const stream of streams) validateStream(stream);
	const objectMode = streams.some(({ readableObjectMode }) => readableObjectMode);
	const highWaterMark = getHighWaterMark(streams, objectMode);
	const passThroughStream = new MergedStream({
		objectMode,
		writableHighWaterMark: highWaterMark,
		readableHighWaterMark: highWaterMark
	});
	for (const stream of streams) passThroughStream.add(stream);
	return passThroughStream;
}
const getHighWaterMark = (streams, objectMode) => {
	if (streams.length === 0) return getDefaultHighWaterMark(objectMode);
	const highWaterMarks = streams.filter(({ readableObjectMode }) => readableObjectMode === objectMode).map(({ readableHighWaterMark }) => readableHighWaterMark);
	return Math.max(...highWaterMarks);
};
var MergedStream = class extends PassThrough {
	#streams = /* @__PURE__ */ new Set([]);
	#ended = /* @__PURE__ */ new Set([]);
	#aborted = /* @__PURE__ */ new Set([]);
	#onFinished;
	#unpipeEvent = Symbol("unpipe");
	#streamPromises = /* @__PURE__ */ new WeakMap();
	add(stream) {
		validateStream(stream);
		if (this.#streams.has(stream)) return;
		this.#streams.add(stream);
		this.#onFinished ??= onMergedStreamFinished(this, this.#streams, this.#unpipeEvent);
		const streamPromise = endWhenStreamsDone({
			passThroughStream: this,
			stream,
			streams: this.#streams,
			ended: this.#ended,
			aborted: this.#aborted,
			onFinished: this.#onFinished,
			unpipeEvent: this.#unpipeEvent
		});
		this.#streamPromises.set(stream, streamPromise);
		stream.pipe(this, { end: false });
	}
	async remove(stream) {
		validateStream(stream);
		if (!this.#streams.has(stream)) return false;
		const streamPromise = this.#streamPromises.get(stream);
		if (streamPromise === void 0) return false;
		this.#streamPromises.delete(stream);
		stream.unpipe(this);
		await streamPromise;
		return true;
	}
};
const onMergedStreamFinished = async (passThroughStream, streams, unpipeEvent) => {
	updateMaxListeners(passThroughStream, PASSTHROUGH_LISTENERS_COUNT);
	const controller = new AbortController();
	try {
		await Promise.race([onMergedStreamEnd(passThroughStream, controller), onInputStreamsUnpipe(passThroughStream, streams, unpipeEvent, controller)]);
	} finally {
		controller.abort();
		updateMaxListeners(passThroughStream, -PASSTHROUGH_LISTENERS_COUNT);
	}
};
const onMergedStreamEnd = async (passThroughStream, { signal }) => {
	try {
		await finished(passThroughStream, {
			signal,
			cleanup: true
		});
	} catch (error) {
		errorOrAbortStream(passThroughStream, error);
		throw error;
	}
};
const onInputStreamsUnpipe = async (passThroughStream, streams, unpipeEvent, { signal }) => {
	for await (const [unpipedStream] of on(passThroughStream, "unpipe", { signal })) if (streams.has(unpipedStream)) unpipedStream.emit(unpipeEvent);
};
const validateStream = (stream) => {
	if (typeof stream?.pipe !== "function") throw new TypeError(`Expected a readable stream, got: \`${typeof stream}\`.`);
};
const endWhenStreamsDone = async ({ passThroughStream, stream, streams, ended, aborted, onFinished, unpipeEvent }) => {
	updateMaxListeners(passThroughStream, PASSTHROUGH_LISTENERS_PER_STREAM);
	const controller = new AbortController();
	try {
		await Promise.race([
			afterMergedStreamFinished(onFinished, stream, controller),
			onInputStreamEnd({
				passThroughStream,
				stream,
				streams,
				ended,
				aborted,
				controller
			}),
			onInputStreamUnpipe({
				stream,
				streams,
				ended,
				aborted,
				unpipeEvent,
				controller
			})
		]);
	} finally {
		controller.abort();
		updateMaxListeners(passThroughStream, -PASSTHROUGH_LISTENERS_PER_STREAM);
	}
	if (streams.size > 0 && streams.size === ended.size + aborted.size) if (ended.size === 0 && aborted.size > 0) abortStream(passThroughStream);
	else endStream(passThroughStream);
};
const afterMergedStreamFinished = async (onFinished, stream, { signal }) => {
	try {
		await onFinished;
		if (!signal.aborted) abortStream(stream);
	} catch (error) {
		if (!signal.aborted) errorOrAbortStream(stream, error);
	}
};
const onInputStreamEnd = async ({ passThroughStream, stream, streams, ended, aborted, controller: { signal } }) => {
	try {
		await finished(stream, {
			signal,
			cleanup: true,
			readable: true,
			writable: false
		});
		if (streams.has(stream)) ended.add(stream);
	} catch (error) {
		if (signal.aborted || !streams.has(stream)) return;
		if (isAbortError(error)) aborted.add(stream);
		else errorStream(passThroughStream, error);
	}
};
const onInputStreamUnpipe = async ({ stream, streams, ended, aborted, unpipeEvent, controller: { signal } }) => {
	await once(stream, unpipeEvent, { signal });
	if (!stream.readable) return once(signal, "abort", { signal });
	streams.delete(stream);
	ended.delete(stream);
	aborted.delete(stream);
};
const endStream = (stream) => {
	if (stream.writable) stream.end();
};
const errorOrAbortStream = (stream, error) => {
	if (isAbortError(error)) abortStream(stream);
	else errorStream(stream, error);
};
const isAbortError = (error) => error?.code === "ERR_STREAM_PREMATURE_CLOSE";
const abortStream = (stream) => {
	if (stream.readable || stream.writable) stream.destroy();
};
const errorStream = (stream, error) => {
	if (!stream.destroyed) {
		stream.once("error", noop);
		stream.destroy(error);
	}
};
const noop = () => {};
const updateMaxListeners = (passThroughStream, increment) => {
	const maxListeners = passThroughStream.getMaxListeners();
	if (maxListeners !== 0 && maxListeners !== Number.POSITIVE_INFINITY) passThroughStream.setMaxListeners(maxListeners + increment);
};
const PASSTHROUGH_LISTENERS_COUNT = 2;
const PASSTHROUGH_LISTENERS_PER_STREAM = 1;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/pipeline.js
const pipeStreams = (source, destination) => {
	source.pipe(destination);
	onSourceFinish(source, destination);
	onDestinationFinish(source, destination);
};
const onSourceFinish = async (source, destination) => {
	if (isStandardStream(source) || isStandardStream(destination)) return;
	try {
		await finished(source, {
			cleanup: true,
			readable: true,
			writable: false
		});
	} catch {}
	endDestinationStream(destination);
};
const endDestinationStream = (destination) => {
	if (destination.writable) destination.end();
};
const onDestinationFinish = async (source, destination) => {
	if (isStandardStream(source) || isStandardStream(destination)) return;
	try {
		await finished(destination, {
			cleanup: true,
			readable: false,
			writable: true
		});
	} catch {}
	abortSourceStream(source);
};
const abortSourceStream = (source) => {
	if (source.readable) source.destroy();
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/output-async.js
const pipeOutputAsync = (subprocess, fileDescriptors, controller) => {
	const pipeGroups = /* @__PURE__ */ new Map();
	for (const [fdNumber, { stdioItems, direction }] of Object.entries(fileDescriptors)) {
		for (const { stream } of stdioItems.filter(({ type }) => TRANSFORM_TYPES.has(type))) pipeTransform(subprocess, stream, direction, fdNumber);
		for (const { stream } of stdioItems.filter(({ type }) => !TRANSFORM_TYPES.has(type))) pipeStdioItem({
			subprocess,
			stream,
			direction,
			fdNumber,
			pipeGroups,
			controller
		});
	}
	for (const [outputStream, inputStreams] of pipeGroups.entries()) pipeStreams(inputStreams.length === 1 ? inputStreams[0] : mergeStreams(inputStreams), outputStream);
};
const pipeTransform = (subprocess, stream, direction, fdNumber) => {
	if (direction === "output") pipeStreams(subprocess.stdio[fdNumber], stream);
	else pipeStreams(stream, subprocess.stdio[fdNumber]);
	const streamProperty = SUBPROCESS_STREAM_PROPERTIES[fdNumber];
	if (streamProperty !== void 0) subprocess[streamProperty] = stream;
	subprocess.stdio[fdNumber] = stream;
};
const SUBPROCESS_STREAM_PROPERTIES = [
	"stdin",
	"stdout",
	"stderr"
];
const pipeStdioItem = ({ subprocess, stream, direction, fdNumber, pipeGroups, controller }) => {
	if (stream === void 0) return;
	setStandardStreamMaxListeners(stream, controller);
	const [inputStream, outputStream] = direction === "output" ? [stream, subprocess.stdio[fdNumber]] : [subprocess.stdio[fdNumber], stream];
	const outputStreams = pipeGroups.get(inputStream) ?? [];
	pipeGroups.set(inputStream, [...outputStreams, outputStream]);
};
const setStandardStreamMaxListeners = (stream, { signal }) => {
	if (isStandardStream(stream)) incrementMaxListeners(stream, MAX_LISTENERS_INCREMENT, signal);
};
const MAX_LISTENERS_INCREMENT = 2;

//#endregion
//#region ../../node_modules/.pnpm/signal-exit@4.1.0/node_modules/signal-exit/dist/mjs/signals.js
/**
* This is not the set of all possible signals.
*
* It IS, however, the set of all signals that trigger
* an exit on either Linux or BSD systems.  Linux is a
* superset of the signal names supported on BSD, and
* the unknown signals just fail to register, so we can
* catch that easily enough.
*
* Windows signals are a different set, since there are
* signals that terminate Windows processes, but don't
* terminate (or don't even exist) on Posix systems.
*
* Don't bother with SIGKILL.  It's uncatchable, which
* means that we can't fire any callbacks anyway.
*
* If a user does happen to register a handler on a non-
* fatal signal like SIGWINCH or something, and then
* exit, it'll end up firing `process.emit('exit')`, so
* the handler will be fired anyway.
*
* SIGBUS, SIGFPE, SIGSEGV and SIGILL, when not raised
* artificially, inherently leave the process in a
* state from which it is not safe to try and enter JS
* listeners.
*/
const signals = [];
signals.push("SIGHUP", "SIGINT", "SIGTERM");
if (process.platform !== "win32") signals.push("SIGALRM", "SIGABRT", "SIGVTALRM", "SIGXCPU", "SIGXFSZ", "SIGUSR2", "SIGTRAP", "SIGSYS", "SIGQUIT", "SIGIOT");
if (process.platform === "linux") signals.push("SIGIO", "SIGPOLL", "SIGPWR", "SIGSTKFLT");

//#endregion
//#region ../../node_modules/.pnpm/signal-exit@4.1.0/node_modules/signal-exit/dist/mjs/index.js
const processOk = (process) => !!process && typeof process === "object" && typeof process.removeListener === "function" && typeof process.emit === "function" && typeof process.reallyExit === "function" && typeof process.listeners === "function" && typeof process.kill === "function" && typeof process.pid === "number" && typeof process.on === "function";
const kExitEmitter = Symbol.for("signal-exit emitter");
const global$1 = globalThis;
const ObjectDefineProperty = Object.defineProperty.bind(Object);
var Emitter = class {
	emitted = {
		afterExit: false,
		exit: false
	};
	listeners = {
		afterExit: [],
		exit: []
	};
	count = 0;
	id = Math.random();
	constructor() {
		if (global$1[kExitEmitter]) return global$1[kExitEmitter];
		ObjectDefineProperty(global$1, kExitEmitter, {
			value: this,
			writable: false,
			enumerable: false,
			configurable: false
		});
	}
	on(ev, fn) {
		this.listeners[ev].push(fn);
	}
	removeListener(ev, fn) {
		const list = this.listeners[ev];
		const i = list.indexOf(fn);
		/* c8 ignore start */
		if (i === -1) return;
		/* c8 ignore stop */
		if (i === 0 && list.length === 1) list.length = 0;
		else list.splice(i, 1);
	}
	emit(ev, code, signal) {
		if (this.emitted[ev]) return false;
		this.emitted[ev] = true;
		let ret = false;
		for (const fn of this.listeners[ev]) ret = fn(code, signal) === true || ret;
		if (ev === "exit") ret = this.emit("afterExit", code, signal) || ret;
		return ret;
	}
};
var SignalExitBase = class {};
const signalExitWrap = (handler) => {
	return {
		onExit(cb, opts) {
			return handler.onExit(cb, opts);
		},
		load() {
			return handler.load();
		},
		unload() {
			return handler.unload();
		}
	};
};
var SignalExitFallback = class extends SignalExitBase {
	onExit() {
		return () => {};
	}
	load() {}
	unload() {}
};
var SignalExit = class extends SignalExitBase {
	/* c8 ignore start */
	#hupSig = process$2.platform === "win32" ? "SIGINT" : "SIGHUP";
	/* c8 ignore stop */
	#emitter = new Emitter();
	#process;
	#originalProcessEmit;
	#originalProcessReallyExit;
	#sigListeners = {};
	#loaded = false;
	constructor(process) {
		super();
		this.#process = process;
		this.#sigListeners = {};
		for (const sig of signals) this.#sigListeners[sig] = () => {
			const listeners = this.#process.listeners(sig);
			let { count } = this.#emitter;
			/* c8 ignore start */
			const p = process;
			if (typeof p.__signal_exit_emitter__ === "object" && typeof p.__signal_exit_emitter__.count === "number") count += p.__signal_exit_emitter__.count;
			/* c8 ignore stop */
			if (listeners.length === count) {
				this.unload();
				const ret = this.#emitter.emit("exit", null, sig);
				/* c8 ignore start */
				const s = sig === "SIGHUP" ? this.#hupSig : sig;
				if (!ret) process.kill(process.pid, s);
			}
		};
		this.#originalProcessReallyExit = process.reallyExit;
		this.#originalProcessEmit = process.emit;
	}
	onExit(cb, opts) {
		/* c8 ignore start */
		if (!processOk(this.#process)) return () => {};
		/* c8 ignore stop */
		if (this.#loaded === false) this.load();
		const ev = opts?.alwaysLast ? "afterExit" : "exit";
		this.#emitter.on(ev, cb);
		return () => {
			this.#emitter.removeListener(ev, cb);
			if (this.#emitter.listeners["exit"].length === 0 && this.#emitter.listeners["afterExit"].length === 0) this.unload();
		};
	}
	load() {
		if (this.#loaded) return;
		this.#loaded = true;
		this.#emitter.count += 1;
		for (const sig of signals) try {
			const fn = this.#sigListeners[sig];
			if (fn) this.#process.on(sig, fn);
		} catch (_) {}
		this.#process.emit = (ev, ...a) => {
			return this.#processEmit(ev, ...a);
		};
		this.#process.reallyExit = (code) => {
			return this.#processReallyExit(code);
		};
	}
	unload() {
		if (!this.#loaded) return;
		this.#loaded = false;
		signals.forEach((sig) => {
			const listener = this.#sigListeners[sig];
			/* c8 ignore start */
			if (!listener) throw new Error("Listener not defined for signal: " + sig);
			/* c8 ignore stop */
			try {
				this.#process.removeListener(sig, listener);
			} catch (_) {}
			/* c8 ignore stop */
		});
		this.#process.emit = this.#originalProcessEmit;
		this.#process.reallyExit = this.#originalProcessReallyExit;
		this.#emitter.count -= 1;
	}
	#processReallyExit(code) {
		/* c8 ignore start */
		if (!processOk(this.#process)) return 0;
		this.#process.exitCode = code || 0;
		/* c8 ignore stop */
		this.#emitter.emit("exit", this.#process.exitCode, null);
		return this.#originalProcessReallyExit.call(this.#process, this.#process.exitCode);
	}
	#processEmit(ev, ...args) {
		const og = this.#originalProcessEmit;
		if (ev === "exit" && processOk(this.#process)) {
			if (typeof args[0] === "number") this.#process.exitCode = args[0];
			/* c8 ignore start */
			const ret = og.call(this.#process, ev, ...args);
			/* c8 ignore start */
			this.#emitter.emit("exit", this.#process.exitCode, null);
			/* c8 ignore stop */
			return ret;
		} else return og.call(this.#process, ev, ...args);
	}
};
const process$2 = globalThis.process;
const { onExit, load, unload } = signalExitWrap(processOk(process$2) ? new SignalExit(process$2) : new SignalExitFallback());

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/terminate/cleanup.js
const cleanupOnExit = (subprocess, { cleanup, detached }, { signal }) => {
	if (!cleanup || detached) return;
	const removeExitHandler = onExit(() => {
		subprocess.kill();
	});
	addAbortListener(signal, () => {
		removeExitHandler();
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/pipe-arguments.js
const normalizePipeArguments = ({ source, sourcePromise, boundOptions, createNested }, ...pipeArguments) => {
	const startTime = getStartTime();
	const { destination, destinationStream, destinationError, from, unpipeSignal } = getDestinationStream(boundOptions, createNested, pipeArguments);
	const { sourceStream, sourceError } = getSourceStream(source, from);
	const { options: sourceOptions, fileDescriptors } = SUBPROCESS_OPTIONS.get(source);
	return {
		sourcePromise,
		sourceStream,
		sourceOptions,
		sourceError,
		destination,
		destinationStream,
		destinationError,
		unpipeSignal,
		fileDescriptors,
		startTime
	};
};
const getDestinationStream = (boundOptions, createNested, pipeArguments) => {
	try {
		const { destination, pipeOptions: { from, to, unpipeSignal } = {} } = getDestination(boundOptions, createNested, ...pipeArguments);
		return {
			destination,
			destinationStream: getToStream(destination, to),
			from,
			unpipeSignal
		};
	} catch (error) {
		return { destinationError: error };
	}
};
const getDestination = (boundOptions, createNested, firstArgument, ...pipeArguments) => {
	if (Array.isArray(firstArgument)) return {
		destination: createNested(mapDestinationArguments, boundOptions)(firstArgument, ...pipeArguments),
		pipeOptions: boundOptions
	};
	if (typeof firstArgument === "string" || firstArgument instanceof URL || isDenoExecPath(firstArgument)) {
		if (Object.keys(boundOptions).length > 0) throw new TypeError("Please use .pipe(\"file\", ..., options) or .pipe(execa(\"file\", ..., options)) instead of .pipe(options)(\"file\", ...).");
		const [rawFile, rawArguments, rawOptions] = normalizeParameters(firstArgument, ...pipeArguments);
		return {
			destination: createNested(mapDestinationArguments)(rawFile, rawArguments, rawOptions),
			pipeOptions: rawOptions
		};
	}
	if (SUBPROCESS_OPTIONS.has(firstArgument)) {
		if (Object.keys(boundOptions).length > 0) throw new TypeError("Please use .pipe(options)`command` or .pipe($(options)`command`) instead of .pipe(options)($`command`).");
		return {
			destination: firstArgument,
			pipeOptions: pipeArguments[0]
		};
	}
	throw new TypeError(`The first argument must be a template string, an options object, or an Execa subprocess: ${firstArgument}`);
};
const mapDestinationArguments = ({ options }) => ({ options: {
	...options,
	stdin: "pipe",
	piped: true
} });
const getSourceStream = (source, from) => {
	try {
		return { sourceStream: getFromStream(source, from) };
	} catch (error) {
		return { sourceError: error };
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/throw.js
const handlePipeArgumentsError = ({ sourceStream, sourceError, destinationStream, destinationError, fileDescriptors, sourceOptions, startTime }) => {
	const error = getPipeArgumentsError({
		sourceStream,
		sourceError,
		destinationStream,
		destinationError
	});
	if (error !== void 0) throw createNonCommandError({
		error,
		fileDescriptors,
		sourceOptions,
		startTime
	});
};
const getPipeArgumentsError = ({ sourceStream, sourceError, destinationStream, destinationError }) => {
	if (sourceError !== void 0 && destinationError !== void 0) return destinationError;
	if (destinationError !== void 0) {
		abortSourceStream(sourceStream);
		return destinationError;
	}
	if (sourceError !== void 0) {
		endDestinationStream(destinationStream);
		return sourceError;
	}
};
const createNonCommandError = ({ error, fileDescriptors, sourceOptions, startTime }) => makeEarlyError({
	error,
	command: PIPE_COMMAND_MESSAGE,
	escapedCommand: PIPE_COMMAND_MESSAGE,
	fileDescriptors,
	options: sourceOptions,
	startTime,
	isSync: false
});
const PIPE_COMMAND_MESSAGE = "source.pipe(destination)";

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/sequence.js
const waitForBothSubprocesses = async (subprocessPromises) => {
	const [{ status: sourceStatus, reason: sourceReason, value: sourceResult = sourceReason }, { status: destinationStatus, reason: destinationReason, value: destinationResult = destinationReason }] = await subprocessPromises;
	if (!destinationResult.pipedFrom.includes(sourceResult)) destinationResult.pipedFrom.push(sourceResult);
	if (destinationStatus === "rejected") throw destinationResult;
	if (sourceStatus === "rejected") throw sourceResult;
	return destinationResult;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/streaming.js
const pipeSubprocessStream = (sourceStream, destinationStream, maxListenersController) => {
	const mergedStream = MERGED_STREAMS.has(destinationStream) ? pipeMoreSubprocessStream(sourceStream, destinationStream) : pipeFirstSubprocessStream(sourceStream, destinationStream);
	incrementMaxListeners(sourceStream, SOURCE_LISTENERS_PER_PIPE, maxListenersController.signal);
	incrementMaxListeners(destinationStream, DESTINATION_LISTENERS_PER_PIPE, maxListenersController.signal);
	cleanupMergedStreamsMap(destinationStream);
	return mergedStream;
};
const pipeFirstSubprocessStream = (sourceStream, destinationStream) => {
	const mergedStream = mergeStreams([sourceStream]);
	pipeStreams(mergedStream, destinationStream);
	MERGED_STREAMS.set(destinationStream, mergedStream);
	return mergedStream;
};
const pipeMoreSubprocessStream = (sourceStream, destinationStream) => {
	const mergedStream = MERGED_STREAMS.get(destinationStream);
	mergedStream.add(sourceStream);
	return mergedStream;
};
const cleanupMergedStreamsMap = async (destinationStream) => {
	try {
		await finished(destinationStream, {
			cleanup: true,
			readable: false,
			writable: true
		});
	} catch {}
	MERGED_STREAMS.delete(destinationStream);
};
const MERGED_STREAMS = /* @__PURE__ */ new WeakMap();
const SOURCE_LISTENERS_PER_PIPE = 2;
const DESTINATION_LISTENERS_PER_PIPE = 1;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/abort.js
const unpipeOnAbort = (unpipeSignal, unpipeContext) => unpipeSignal === void 0 ? [] : [unpipeOnSignalAbort(unpipeSignal, unpipeContext)];
const unpipeOnSignalAbort = async (unpipeSignal, { sourceStream, mergedStream, fileDescriptors, sourceOptions, startTime }) => {
	await aborted(unpipeSignal, sourceStream);
	await mergedStream.remove(sourceStream);
	throw createNonCommandError({
		error: /* @__PURE__ */ new Error("Pipe canceled by `unpipeSignal` option."),
		fileDescriptors,
		sourceOptions,
		startTime
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/pipe/setup.js
const pipeToSubprocess = (sourceInfo, ...pipeArguments) => {
	if (isPlainObject$1(pipeArguments[0])) return pipeToSubprocess.bind(void 0, {
		...sourceInfo,
		boundOptions: {
			...sourceInfo.boundOptions,
			...pipeArguments[0]
		}
	});
	const { destination, ...normalizedInfo } = normalizePipeArguments(sourceInfo, ...pipeArguments);
	const promise = handlePipePromise({
		...normalizedInfo,
		destination
	});
	promise.pipe = pipeToSubprocess.bind(void 0, {
		...sourceInfo,
		source: destination,
		sourcePromise: promise,
		boundOptions: {}
	});
	return promise;
};
const handlePipePromise = async ({ sourcePromise, sourceStream, sourceOptions, sourceError, destination, destinationStream, destinationError, unpipeSignal, fileDescriptors, startTime }) => {
	const subprocessPromises = getSubprocessPromises(sourcePromise, destination);
	handlePipeArgumentsError({
		sourceStream,
		sourceError,
		destinationStream,
		destinationError,
		fileDescriptors,
		sourceOptions,
		startTime
	});
	const maxListenersController = new AbortController();
	try {
		const mergedStream = pipeSubprocessStream(sourceStream, destinationStream, maxListenersController);
		return await Promise.race([waitForBothSubprocesses(subprocessPromises), ...unpipeOnAbort(unpipeSignal, {
			sourceStream,
			mergedStream,
			sourceOptions,
			fileDescriptors,
			startTime
		})]);
	} finally {
		maxListenersController.abort();
	}
};
const getSubprocessPromises = (sourcePromise, destination) => Promise.allSettled([sourcePromise, destination]);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/iterate.js
const iterateOnSubprocessStream = ({ subprocessStdout, subprocess, binary, shouldEncode, encoding, preserveNewlines }) => {
	const controller = new AbortController();
	stopReadingOnExit(subprocess, controller);
	return iterateOnStream({
		stream: subprocessStdout,
		controller,
		binary,
		shouldEncode: !subprocessStdout.readableObjectMode && shouldEncode,
		encoding,
		shouldSplit: !subprocessStdout.readableObjectMode,
		preserveNewlines
	});
};
const stopReadingOnExit = async (subprocess, controller) => {
	try {
		await subprocess;
	} catch {} finally {
		controller.abort();
	}
};
const iterateForResult = ({ stream, onStreamEnd, lines, encoding, stripFinalNewline, allMixed }) => {
	const controller = new AbortController();
	stopReadingOnStreamEnd(onStreamEnd, controller, stream);
	const objectMode = stream.readableObjectMode && !allMixed;
	return iterateOnStream({
		stream,
		controller,
		binary: encoding === "buffer",
		shouldEncode: !objectMode,
		encoding,
		shouldSplit: !objectMode && lines,
		preserveNewlines: !stripFinalNewline
	});
};
const stopReadingOnStreamEnd = async (onStreamEnd, controller, stream) => {
	try {
		await onStreamEnd;
	} catch {
		stream.destroy();
	} finally {
		controller.abort();
	}
};
const iterateOnStream = ({ stream, controller, binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) => {
	const onStdoutChunk = on(stream, "data", {
		signal: controller.signal,
		highWaterMark: HIGH_WATER_MARK,
		highWatermark: HIGH_WATER_MARK
	});
	return iterateOnData({
		onStdoutChunk,
		controller,
		binary,
		shouldEncode,
		encoding,
		shouldSplit,
		preserveNewlines
	});
};
const DEFAULT_OBJECT_HIGH_WATER_MARK = getDefaultHighWaterMark(true);
const HIGH_WATER_MARK = DEFAULT_OBJECT_HIGH_WATER_MARK;
const iterateOnData = async function* ({ onStdoutChunk, controller, binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) {
	const generators = getGenerators({
		binary,
		shouldEncode,
		encoding,
		shouldSplit,
		preserveNewlines
	});
	try {
		for await (const [chunk] of onStdoutChunk) yield* transformChunkSync(chunk, generators, 0);
	} catch (error) {
		if (!controller.signal.aborted) throw error;
	} finally {
		yield* finalChunksSync(generators);
	}
};
const getGenerators = ({ binary, shouldEncode, encoding, shouldSplit, preserveNewlines }) => [getEncodingTransformGenerator(binary, encoding, !shouldEncode), getSplitLinesGenerator(binary, preserveNewlines, !shouldSplit, {})].filter(Boolean);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/io/contents.js
const getStreamOutput = async ({ stream, onStreamEnd, fdNumber, encoding, buffer, maxBuffer, lines, allMixed, stripFinalNewline, verboseInfo, streamInfo }) => {
	const logPromise = logOutputAsync({
		stream,
		onStreamEnd,
		fdNumber,
		encoding,
		allMixed,
		verboseInfo,
		streamInfo
	});
	if (!buffer) {
		await Promise.all([resumeStream(stream), logPromise]);
		return;
	}
	const iterable = iterateForResult({
		stream,
		onStreamEnd,
		lines,
		encoding,
		stripFinalNewline: getStripFinalNewline(stripFinalNewline, fdNumber),
		allMixed
	});
	const [output] = await Promise.all([getStreamContents({
		stream,
		iterable,
		fdNumber,
		encoding,
		maxBuffer,
		lines
	}), logPromise]);
	return output;
};
const logOutputAsync = async ({ stream, onStreamEnd, fdNumber, encoding, allMixed, verboseInfo, streamInfo: { fileDescriptors } }) => {
	if (!shouldLogOutput({
		stdioItems: fileDescriptors[fdNumber]?.stdioItems,
		encoding,
		verboseInfo,
		fdNumber
	})) return;
	await logLines(iterateForResult({
		stream,
		onStreamEnd,
		lines: true,
		encoding,
		stripFinalNewline: true,
		allMixed
	}), stream, fdNumber, verboseInfo);
};
const resumeStream = async (stream) => {
	await setImmediate();
	if (stream.readableFlowing === null) stream.resume();
};
const getStreamContents = async ({ stream, stream: { readableObjectMode }, iterable, fdNumber, encoding, maxBuffer, lines }) => {
	try {
		if (readableObjectMode || lines) return await getStreamAsArray(iterable, { maxBuffer });
		if (encoding === "buffer") return new Uint8Array(await getStreamAsArrayBuffer(iterable, { maxBuffer }));
		return await getStreamAsString(iterable, { maxBuffer });
	} catch (error) {
		return handleBufferedData(handleMaxBuffer({
			error,
			stream,
			readableObjectMode,
			lines,
			encoding,
			fdNumber
		}));
	}
};
const getBufferedData = async (streamPromise) => {
	try {
		return await streamPromise;
	} catch (error) {
		return handleBufferedData(error);
	}
};
const handleBufferedData = ({ bufferedData }) => isArrayBuffer(bufferedData) ? new Uint8Array(bufferedData) : bufferedData;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/wait-stream.js
const waitForStream = async (stream, fdNumber, streamInfo, { isSameDirection, stopOnExit = false } = {}) => {
	const state = handleStdinDestroy(stream, streamInfo);
	const abortController = new AbortController();
	try {
		await Promise.race([...stopOnExit ? [streamInfo.exitPromise] : [], finished(stream, {
			cleanup: true,
			signal: abortController.signal
		})]);
	} catch (error) {
		if (!state.stdinCleanedUp) handleStreamError(error, fdNumber, streamInfo, isSameDirection);
	} finally {
		abortController.abort();
	}
};
const handleStdinDestroy = (stream, { originalStreams: [originalStdin], subprocess }) => {
	const state = { stdinCleanedUp: false };
	if (stream === originalStdin) spyOnStdinDestroy(stream, subprocess, state);
	return state;
};
const spyOnStdinDestroy = (subprocessStdin, subprocess, state) => {
	const { _destroy } = subprocessStdin;
	subprocessStdin._destroy = (...destroyArguments) => {
		setStdinCleanedUp(subprocess, state);
		_destroy.call(subprocessStdin, ...destroyArguments);
	};
};
const setStdinCleanedUp = ({ exitCode, signalCode }, state) => {
	if (exitCode !== null || signalCode !== null) state.stdinCleanedUp = true;
};
const handleStreamError = (error, fdNumber, streamInfo, isSameDirection) => {
	if (!shouldIgnoreStreamError(error, fdNumber, streamInfo, isSameDirection)) throw error;
};
const shouldIgnoreStreamError = (error, fdNumber, streamInfo, isSameDirection = true) => {
	if (streamInfo.propagating) return isStreamEpipe(error) || isStreamAbort(error);
	streamInfo.propagating = true;
	return isInputFileDescriptor(streamInfo, fdNumber) === isSameDirection ? isStreamEpipe(error) : isStreamAbort(error);
};
const isInputFileDescriptor = ({ fileDescriptors }, fdNumber) => fdNumber !== "all" && fileDescriptors[fdNumber].direction === "input";
const isStreamAbort = (error) => error?.code === "ERR_STREAM_PREMATURE_CLOSE";
const isStreamEpipe = (error) => error?.code === "EPIPE";

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/stdio.js
const waitForStdioStreams = ({ subprocess, encoding, buffer, maxBuffer, lines, stripFinalNewline, verboseInfo, streamInfo }) => subprocess.stdio.map((stream, fdNumber) => waitForSubprocessStream({
	stream,
	fdNumber,
	encoding,
	buffer: buffer[fdNumber],
	maxBuffer: maxBuffer[fdNumber],
	lines: lines[fdNumber],
	allMixed: false,
	stripFinalNewline,
	verboseInfo,
	streamInfo
}));
const waitForSubprocessStream = async ({ stream, fdNumber, encoding, buffer, maxBuffer, lines, allMixed, stripFinalNewline, verboseInfo, streamInfo }) => {
	if (!stream) return;
	const onStreamEnd = waitForStream(stream, fdNumber, streamInfo);
	if (isInputFileDescriptor(streamInfo, fdNumber)) {
		await onStreamEnd;
		return;
	}
	const [output] = await Promise.all([getStreamOutput({
		stream,
		onStreamEnd,
		fdNumber,
		encoding,
		buffer,
		maxBuffer,
		lines,
		allMixed,
		stripFinalNewline,
		verboseInfo,
		streamInfo
	}), onStreamEnd]);
	return output;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/all-async.js
const makeAllStream = ({ stdout, stderr }, { all }) => all && (stdout || stderr) ? mergeStreams([stdout, stderr].filter(Boolean)) : void 0;
const waitForAllStream = ({ subprocess, encoding, buffer, maxBuffer, lines, stripFinalNewline, verboseInfo, streamInfo }) => waitForSubprocessStream({
	...getAllStream(subprocess, buffer),
	fdNumber: "all",
	encoding,
	maxBuffer: maxBuffer[1] + maxBuffer[2],
	lines: lines[1] || lines[2],
	allMixed: getAllMixed(subprocess),
	stripFinalNewline,
	verboseInfo,
	streamInfo
});
const getAllStream = ({ stdout, stderr, all }, [, bufferStdout, bufferStderr]) => {
	const buffer = bufferStdout || bufferStderr;
	if (!buffer) return {
		stream: all,
		buffer
	};
	if (!bufferStdout) return {
		stream: stderr,
		buffer
	};
	if (!bufferStderr) return {
		stream: stdout,
		buffer
	};
	return {
		stream: all,
		buffer
	};
};
const getAllMixed = ({ all, stdout, stderr }) => all && stdout && stderr && stdout.readableObjectMode !== stderr.readableObjectMode;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/verbose/ipc.js
const shouldLogIpc = (verboseInfo) => isFullVerbose(verboseInfo, "ipc");
const logIpcOutput = (message, verboseInfo) => {
	verboseLog({
		type: "ipc",
		verboseMessage: serializeVerboseMessage(message),
		fdNumber: "ipc",
		verboseInfo
	});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/ipc/buffer-messages.js
const waitForIpcOutput = async ({ subprocess, buffer: bufferArray, maxBuffer: maxBufferArray, ipc, ipcOutput, verboseInfo }) => {
	if (!ipc) return ipcOutput;
	const isVerbose = shouldLogIpc(verboseInfo);
	const buffer = getFdSpecificValue(bufferArray, "ipc");
	const maxBuffer = getFdSpecificValue(maxBufferArray, "ipc");
	for await (const message of loopOnMessages({
		anyProcess: subprocess,
		channel: subprocess.channel,
		isSubprocess: false,
		ipc,
		shouldAwait: false,
		reference: true
	})) {
		if (buffer) {
			checkIpcMaxBuffer(subprocess, ipcOutput, maxBuffer);
			ipcOutput.push(message);
		}
		if (isVerbose) logIpcOutput(message, verboseInfo);
	}
	return ipcOutput;
};
const getBufferedIpcOutput = async (ipcOutputPromise, ipcOutput) => {
	await Promise.allSettled([ipcOutputPromise]);
	return ipcOutput;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/resolve/wait-subprocess.js
const waitForSubprocessResult = async ({ subprocess, options: { encoding, buffer, maxBuffer, lines, timeoutDuration: timeout, cancelSignal, gracefulCancel, forceKillAfterDelay, stripFinalNewline, ipc, ipcInput }, context, verboseInfo, fileDescriptors, originalStreams, onInternalError, controller }) => {
	const exitPromise = waitForExit(subprocess, context);
	const streamInfo = {
		originalStreams,
		fileDescriptors,
		subprocess,
		exitPromise,
		propagating: false
	};
	const stdioPromises = waitForStdioStreams({
		subprocess,
		encoding,
		buffer,
		maxBuffer,
		lines,
		stripFinalNewline,
		verboseInfo,
		streamInfo
	});
	const allPromise = waitForAllStream({
		subprocess,
		encoding,
		buffer,
		maxBuffer,
		lines,
		stripFinalNewline,
		verboseInfo,
		streamInfo
	});
	const ipcOutput = [];
	const ipcOutputPromise = waitForIpcOutput({
		subprocess,
		buffer,
		maxBuffer,
		ipc,
		ipcOutput,
		verboseInfo
	});
	const originalPromises = waitForOriginalStreams(originalStreams, subprocess, streamInfo);
	const customStreamsEndPromises = waitForCustomStreamsEnd(fileDescriptors, streamInfo);
	try {
		return await Promise.race([
			Promise.all([
				{},
				waitForSuccessfulExit(exitPromise),
				Promise.all(stdioPromises),
				allPromise,
				ipcOutputPromise,
				sendIpcInput(subprocess, ipcInput),
				...originalPromises,
				...customStreamsEndPromises
			]),
			onInternalError,
			throwOnSubprocessError(subprocess, controller),
			...throwOnTimeout(subprocess, timeout, context, controller),
			...throwOnCancel({
				subprocess,
				cancelSignal,
				gracefulCancel,
				context,
				controller
			}),
			...throwOnGracefulCancel({
				subprocess,
				cancelSignal,
				gracefulCancel,
				forceKillAfterDelay,
				context,
				controller
			})
		]);
	} catch (error) {
		context.terminationReason ??= "other";
		return Promise.all([
			{ error },
			exitPromise,
			Promise.all(stdioPromises.map((stdioPromise) => getBufferedData(stdioPromise))),
			getBufferedData(allPromise),
			getBufferedIpcOutput(ipcOutputPromise, ipcOutput),
			Promise.allSettled(originalPromises),
			Promise.allSettled(customStreamsEndPromises)
		]);
	}
};
const waitForOriginalStreams = (originalStreams, subprocess, streamInfo) => originalStreams.map((stream, fdNumber) => stream === subprocess.stdio[fdNumber] ? void 0 : waitForStream(stream, fdNumber, streamInfo));
const waitForCustomStreamsEnd = (fileDescriptors, streamInfo) => fileDescriptors.flatMap(({ stdioItems }, fdNumber) => stdioItems.filter(({ value, stream = value }) => isStream(stream, { checkOpen: false }) && !isStandardStream(stream)).map(({ type, value, stream = value }) => waitForStream(stream, fdNumber, streamInfo, {
	isSameDirection: TRANSFORM_TYPES.has(type),
	stopOnExit: type === "native"
})));
const throwOnSubprocessError = async (subprocess, { signal }) => {
	const [error] = await once(subprocess, "error", { signal });
	throw error;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/concurrent.js
const initializeConcurrentStreams = () => ({
	readableDestroy: /* @__PURE__ */ new WeakMap(),
	writableFinal: /* @__PURE__ */ new WeakMap(),
	writableDestroy: /* @__PURE__ */ new WeakMap()
});
const addConcurrentStream = (concurrentStreams, stream, waitName) => {
	const weakMap = concurrentStreams[waitName];
	if (!weakMap.has(stream)) weakMap.set(stream, []);
	const promises = weakMap.get(stream);
	const promise = createDeferred();
	promises.push(promise);
	return {
		resolve: promise.resolve.bind(promise),
		promises
	};
};
const waitForConcurrentStreams = async ({ resolve, promises }, subprocess) => {
	resolve();
	const [isSubprocessExit] = await Promise.race([Promise.allSettled([true, subprocess]), Promise.all([false, ...promises])]);
	return !isSubprocessExit;
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/shared.js
const safeWaitForSubprocessStdin = async (subprocessStdin) => {
	if (subprocessStdin === void 0) return;
	try {
		await waitForSubprocessStdin(subprocessStdin);
	} catch {}
};
const safeWaitForSubprocessStdout = async (subprocessStdout) => {
	if (subprocessStdout === void 0) return;
	try {
		await waitForSubprocessStdout(subprocessStdout);
	} catch {}
};
const waitForSubprocessStdin = async (subprocessStdin) => {
	await finished(subprocessStdin, {
		cleanup: true,
		readable: false,
		writable: true
	});
};
const waitForSubprocessStdout = async (subprocessStdout) => {
	await finished(subprocessStdout, {
		cleanup: true,
		readable: true,
		writable: false
	});
};
const waitForSubprocess = async (subprocess, error) => {
	await subprocess;
	if (error) throw error;
};
const destroyOtherStream = (stream, isOpen, error) => {
	if (error && !isStreamAbort(error)) stream.destroy(error);
	else if (isOpen) stream.destroy();
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/readable.js
const createReadable = ({ subprocess, concurrentStreams, encoding }, { from, binary: binaryOption = true, preserveNewlines = true } = {}) => {
	const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
	const { subprocessStdout, waitReadableDestroy } = getSubprocessStdout(subprocess, from, concurrentStreams);
	const { readableEncoding, readableObjectMode, readableHighWaterMark } = getReadableOptions(subprocessStdout, binary);
	const { read, onStdoutDataDone } = getReadableMethods({
		subprocessStdout,
		subprocess,
		binary,
		encoding,
		preserveNewlines
	});
	const readable = new Readable({
		read,
		destroy: callbackify(onReadableDestroy.bind(void 0, {
			subprocessStdout,
			subprocess,
			waitReadableDestroy
		})),
		highWaterMark: readableHighWaterMark,
		objectMode: readableObjectMode,
		encoding: readableEncoding
	});
	onStdoutFinished({
		subprocessStdout,
		onStdoutDataDone,
		readable,
		subprocess
	});
	return readable;
};
const getSubprocessStdout = (subprocess, from, concurrentStreams) => {
	const subprocessStdout = getFromStream(subprocess, from);
	return {
		subprocessStdout,
		waitReadableDestroy: addConcurrentStream(concurrentStreams, subprocessStdout, "readableDestroy")
	};
};
const getReadableOptions = ({ readableEncoding, readableObjectMode, readableHighWaterMark }, binary) => binary ? {
	readableEncoding,
	readableObjectMode,
	readableHighWaterMark
} : {
	readableEncoding,
	readableObjectMode: true,
	readableHighWaterMark: DEFAULT_OBJECT_HIGH_WATER_MARK
};
const getReadableMethods = ({ subprocessStdout, subprocess, binary, encoding, preserveNewlines }) => {
	const onStdoutDataDone = createDeferred();
	const onStdoutData = iterateOnSubprocessStream({
		subprocessStdout,
		subprocess,
		binary,
		shouldEncode: !binary,
		encoding,
		preserveNewlines
	});
	return {
		read() {
			onRead(this, onStdoutData, onStdoutDataDone);
		},
		onStdoutDataDone
	};
};
const onRead = async (readable, onStdoutData, onStdoutDataDone) => {
	try {
		const { value, done } = await onStdoutData.next();
		if (done) onStdoutDataDone.resolve();
		else readable.push(value);
	} catch {}
};
const onStdoutFinished = async ({ subprocessStdout, onStdoutDataDone, readable, subprocess, subprocessStdin }) => {
	try {
		await waitForSubprocessStdout(subprocessStdout);
		await subprocess;
		await safeWaitForSubprocessStdin(subprocessStdin);
		await onStdoutDataDone;
		if (readable.readable) readable.push(null);
	} catch (error) {
		await safeWaitForSubprocessStdin(subprocessStdin);
		destroyOtherReadable(readable, error);
	}
};
const onReadableDestroy = async ({ subprocessStdout, subprocess, waitReadableDestroy }, error) => {
	if (await waitForConcurrentStreams(waitReadableDestroy, subprocess)) {
		destroyOtherReadable(subprocessStdout, error);
		await waitForSubprocess(subprocess, error);
	}
};
const destroyOtherReadable = (stream, error) => {
	destroyOtherStream(stream, stream.readable, error);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/writable.js
const createWritable = ({ subprocess, concurrentStreams }, { to } = {}) => {
	const { subprocessStdin, waitWritableFinal, waitWritableDestroy } = getSubprocessStdin(subprocess, to, concurrentStreams);
	const writable = new Writable({
		...getWritableMethods(subprocessStdin, subprocess, waitWritableFinal),
		destroy: callbackify(onWritableDestroy.bind(void 0, {
			subprocessStdin,
			subprocess,
			waitWritableFinal,
			waitWritableDestroy
		})),
		highWaterMark: subprocessStdin.writableHighWaterMark,
		objectMode: subprocessStdin.writableObjectMode
	});
	onStdinFinished(subprocessStdin, writable);
	return writable;
};
const getSubprocessStdin = (subprocess, to, concurrentStreams) => {
	const subprocessStdin = getToStream(subprocess, to);
	return {
		subprocessStdin,
		waitWritableFinal: addConcurrentStream(concurrentStreams, subprocessStdin, "writableFinal"),
		waitWritableDestroy: addConcurrentStream(concurrentStreams, subprocessStdin, "writableDestroy")
	};
};
const getWritableMethods = (subprocessStdin, subprocess, waitWritableFinal) => ({
	write: onWrite.bind(void 0, subprocessStdin),
	final: callbackify(onWritableFinal.bind(void 0, subprocessStdin, subprocess, waitWritableFinal))
});
const onWrite = (subprocessStdin, chunk, encoding, done) => {
	if (subprocessStdin.write(chunk, encoding)) done();
	else subprocessStdin.once("drain", done);
};
const onWritableFinal = async (subprocessStdin, subprocess, waitWritableFinal) => {
	if (await waitForConcurrentStreams(waitWritableFinal, subprocess)) {
		if (subprocessStdin.writable) subprocessStdin.end();
		await subprocess;
	}
};
const onStdinFinished = async (subprocessStdin, writable, subprocessStdout) => {
	try {
		await waitForSubprocessStdin(subprocessStdin);
		if (writable.writable) writable.end();
	} catch (error) {
		await safeWaitForSubprocessStdout(subprocessStdout);
		destroyOtherWritable(writable, error);
	}
};
const onWritableDestroy = async ({ subprocessStdin, subprocess, waitWritableFinal, waitWritableDestroy }, error) => {
	await waitForConcurrentStreams(waitWritableFinal, subprocess);
	if (await waitForConcurrentStreams(waitWritableDestroy, subprocess)) {
		destroyOtherWritable(subprocessStdin, error);
		await waitForSubprocess(subprocess, error);
	}
};
const destroyOtherWritable = (stream, error) => {
	destroyOtherStream(stream, stream.writable, error);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/duplex.js
const createDuplex = ({ subprocess, concurrentStreams, encoding }, { from, to, binary: binaryOption = true, preserveNewlines = true } = {}) => {
	const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
	const { subprocessStdout, waitReadableDestroy } = getSubprocessStdout(subprocess, from, concurrentStreams);
	const { subprocessStdin, waitWritableFinal, waitWritableDestroy } = getSubprocessStdin(subprocess, to, concurrentStreams);
	const { readableEncoding, readableObjectMode, readableHighWaterMark } = getReadableOptions(subprocessStdout, binary);
	const { read, onStdoutDataDone } = getReadableMethods({
		subprocessStdout,
		subprocess,
		binary,
		encoding,
		preserveNewlines
	});
	const duplex = new Duplex({
		read,
		...getWritableMethods(subprocessStdin, subprocess, waitWritableFinal),
		destroy: callbackify(onDuplexDestroy.bind(void 0, {
			subprocessStdout,
			subprocessStdin,
			subprocess,
			waitReadableDestroy,
			waitWritableFinal,
			waitWritableDestroy
		})),
		readableHighWaterMark,
		writableHighWaterMark: subprocessStdin.writableHighWaterMark,
		readableObjectMode,
		writableObjectMode: subprocessStdin.writableObjectMode,
		encoding: readableEncoding
	});
	onStdoutFinished({
		subprocessStdout,
		onStdoutDataDone,
		readable: duplex,
		subprocess,
		subprocessStdin
	});
	onStdinFinished(subprocessStdin, duplex, subprocessStdout);
	return duplex;
};
const onDuplexDestroy = async ({ subprocessStdout, subprocessStdin, subprocess, waitReadableDestroy, waitWritableFinal, waitWritableDestroy }, error) => {
	await Promise.all([onReadableDestroy({
		subprocessStdout,
		subprocess,
		waitReadableDestroy
	}, error), onWritableDestroy({
		subprocessStdin,
		subprocess,
		waitWritableFinal,
		waitWritableDestroy
	}, error)]);
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/iterable.js
const createIterable = (subprocess, encoding, { from, binary: binaryOption = false, preserveNewlines = false } = {}) => {
	const binary = binaryOption || BINARY_ENCODINGS.has(encoding);
	const subprocessStdout = getFromStream(subprocess, from);
	const onStdoutData = iterateOnSubprocessStream({
		subprocessStdout,
		subprocess,
		binary,
		shouldEncode: true,
		encoding,
		preserveNewlines
	});
	return iterateOnStdoutData(onStdoutData, subprocessStdout, subprocess);
};
const iterateOnStdoutData = async function* (onStdoutData, subprocessStdout, subprocess) {
	try {
		yield* onStdoutData;
	} finally {
		if (subprocessStdout.readable) subprocessStdout.destroy();
		await subprocess;
	}
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/convert/add.js
const addConvertedStreams = (subprocess, { encoding }) => {
	const concurrentStreams = initializeConcurrentStreams();
	subprocess.readable = createReadable.bind(void 0, {
		subprocess,
		concurrentStreams,
		encoding
	});
	subprocess.writable = createWritable.bind(void 0, {
		subprocess,
		concurrentStreams
	});
	subprocess.duplex = createDuplex.bind(void 0, {
		subprocess,
		concurrentStreams,
		encoding
	});
	subprocess.iterable = createIterable.bind(void 0, subprocess, encoding);
	subprocess[Symbol.asyncIterator] = createIterable.bind(void 0, subprocess, encoding, {});
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/promise.js
const mergePromise = (subprocess, promise) => {
	for (const [property, descriptor] of descriptors) {
		const value = descriptor.value.bind(promise);
		Reflect.defineProperty(subprocess, property, {
			...descriptor,
			value
		});
	}
};
const nativePromisePrototype = (async () => {})().constructor.prototype;
const descriptors = [
	"then",
	"catch",
	"finally"
].map((property) => [property, Reflect.getOwnPropertyDescriptor(nativePromisePrototype, property)]);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/main-async.js
const execaCoreAsync = (rawFile, rawArguments, rawOptions, createNested) => {
	const { file, commandArguments, command, escapedCommand, startTime, verboseInfo, options, fileDescriptors } = handleAsyncArguments(rawFile, rawArguments, rawOptions);
	const { subprocess, promise } = spawnSubprocessAsync({
		file,
		commandArguments,
		options,
		startTime,
		verboseInfo,
		command,
		escapedCommand,
		fileDescriptors
	});
	subprocess.pipe = pipeToSubprocess.bind(void 0, {
		source: subprocess,
		sourcePromise: promise,
		boundOptions: {},
		createNested
	});
	mergePromise(subprocess, promise);
	SUBPROCESS_OPTIONS.set(subprocess, {
		options,
		fileDescriptors
	});
	return subprocess;
};
const handleAsyncArguments = (rawFile, rawArguments, rawOptions) => {
	const { command, escapedCommand, startTime, verboseInfo } = handleCommand(rawFile, rawArguments, rawOptions);
	const { file, commandArguments, options: normalizedOptions } = normalizeOptions(rawFile, rawArguments, rawOptions);
	const options = handleAsyncOptions(normalizedOptions);
	return {
		file,
		commandArguments,
		command,
		escapedCommand,
		startTime,
		verboseInfo,
		options,
		fileDescriptors: handleStdioAsync(options, verboseInfo)
	};
};
const handleAsyncOptions = ({ timeout, signal, ...options }) => {
	if (signal !== void 0) throw new TypeError("The \"signal\" option has been renamed to \"cancelSignal\" instead.");
	return {
		...options,
		timeoutDuration: timeout
	};
};
const spawnSubprocessAsync = ({ file, commandArguments, options, startTime, verboseInfo, command, escapedCommand, fileDescriptors }) => {
	let subprocess;
	try {
		subprocess = spawn(...concatenateShell(file, commandArguments, options));
	} catch (error) {
		return handleEarlyError({
			error,
			command,
			escapedCommand,
			fileDescriptors,
			options,
			startTime,
			verboseInfo
		});
	}
	const controller = new AbortController();
	setMaxListeners(Number.POSITIVE_INFINITY, controller.signal);
	const originalStreams = [...subprocess.stdio];
	pipeOutputAsync(subprocess, fileDescriptors, controller);
	cleanupOnExit(subprocess, options, controller);
	const context = {};
	const onInternalError = createDeferred();
	subprocess.kill = subprocessKill.bind(void 0, {
		kill: subprocess.kill.bind(subprocess),
		options,
		onInternalError,
		context,
		controller
	});
	subprocess.all = makeAllStream(subprocess, options);
	addConvertedStreams(subprocess, options);
	addIpcMethods(subprocess, options);
	const promise = handlePromise({
		subprocess,
		options,
		startTime,
		verboseInfo,
		fileDescriptors,
		originalStreams,
		command,
		escapedCommand,
		context,
		onInternalError,
		controller
	});
	return {
		subprocess,
		promise
	};
};
const handlePromise = async ({ subprocess, options, startTime, verboseInfo, fileDescriptors, originalStreams, command, escapedCommand, context, onInternalError, controller }) => {
	const [errorInfo, [exitCode, signal], stdioResults, allResult, ipcOutput] = await waitForSubprocessResult({
		subprocess,
		options,
		context,
		verboseInfo,
		fileDescriptors,
		originalStreams,
		onInternalError,
		controller
	});
	controller.abort();
	onInternalError.resolve();
	const stdio = stdioResults.map((stdioResult, fdNumber) => stripNewline(stdioResult, options, fdNumber));
	const all = stripNewline(allResult, options, "all");
	return handleResult(getAsyncResult({
		errorInfo,
		exitCode,
		signal,
		stdio,
		all,
		ipcOutput,
		context,
		options,
		command,
		escapedCommand,
		startTime
	}), verboseInfo, options);
};
const getAsyncResult = ({ errorInfo, exitCode, signal, stdio, all, ipcOutput, context, options, command, escapedCommand, startTime }) => "error" in errorInfo ? makeError({
	error: errorInfo.error,
	command,
	escapedCommand,
	timedOut: context.terminationReason === "timeout",
	isCanceled: context.terminationReason === "cancel" || context.terminationReason === "gracefulCancel",
	isGracefullyCanceled: context.terminationReason === "gracefulCancel",
	isMaxBuffer: errorInfo.error instanceof MaxBufferError,
	isForcefullyTerminated: context.isForcefullyTerminated,
	exitCode,
	signal,
	stdio,
	all,
	ipcOutput,
	options,
	startTime,
	isSync: false
}) : makeSuccessResult({
	command,
	escapedCommand,
	stdio,
	all,
	ipcOutput,
	options,
	startTime
});

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/bind.js
const mergeOptions = (boundOptions, options) => {
	const newOptions = Object.fromEntries(Object.entries(options).map(([optionName, optionValue]) => [optionName, mergeOption(optionName, boundOptions[optionName], optionValue)]));
	return {
		...boundOptions,
		...newOptions
	};
};
const mergeOption = (optionName, boundOptionValue, optionValue) => {
	if (DEEP_OPTIONS.has(optionName) && isPlainObject$1(boundOptionValue) && isPlainObject$1(optionValue)) return {
		...boundOptionValue,
		...optionValue
	};
	return optionValue;
};
const DEEP_OPTIONS = /* @__PURE__ */ new Set(["env", ...FD_SPECIFIC_OPTIONS]);

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/create.js
const createExeca = (mapArguments, boundOptions, deepOptions, setBoundExeca) => {
	const createNested = (mapArguments, boundOptions, setBoundExeca) => createExeca(mapArguments, boundOptions, deepOptions, setBoundExeca);
	const boundExeca = (...execaArguments) => callBoundExeca({
		mapArguments,
		deepOptions,
		boundOptions,
		setBoundExeca,
		createNested
	}, ...execaArguments);
	if (setBoundExeca !== void 0) setBoundExeca(boundExeca, createNested, boundOptions);
	return boundExeca;
};
const callBoundExeca = ({ mapArguments, deepOptions = {}, boundOptions = {}, setBoundExeca, createNested }, firstArgument, ...nextArguments) => {
	if (isPlainObject$1(firstArgument)) return createNested(mapArguments, mergeOptions(boundOptions, firstArgument), setBoundExeca);
	const { file, commandArguments, options, isSync } = parseArguments({
		mapArguments,
		firstArgument,
		nextArguments,
		deepOptions,
		boundOptions
	});
	return isSync ? execaCoreSync(file, commandArguments, options) : execaCoreAsync(file, commandArguments, options, createNested);
};
const parseArguments = ({ mapArguments, firstArgument, nextArguments, deepOptions, boundOptions }) => {
	const [initialFile, initialArguments, initialOptions] = normalizeParameters(...isTemplateString(firstArgument) ? parseTemplates(firstArgument, nextArguments) : [firstArgument, ...nextArguments]);
	const mergedOptions = mergeOptions(mergeOptions(deepOptions, boundOptions), initialOptions);
	const { file = initialFile, commandArguments = initialArguments, options = mergedOptions, isSync = false } = mapArguments({
		file: initialFile,
		commandArguments: initialArguments,
		options: mergedOptions
	});
	return {
		file,
		commandArguments,
		options,
		isSync
	};
};

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/command.js
const mapCommandAsync = ({ file, commandArguments }) => parseCommand(file, commandArguments);
const mapCommandSync = ({ file, commandArguments }) => ({
	...parseCommand(file, commandArguments),
	isSync: true
});
const parseCommand = (command, unusedArguments) => {
	if (unusedArguments.length > 0) throw new TypeError(`The command and its arguments must be passed as a single string: ${command} ${unusedArguments}.`);
	const [file, ...commandArguments] = parseCommandString(command);
	return {
		file,
		commandArguments
	};
};
const parseCommandString = (command) => {
	if (typeof command !== "string") throw new TypeError(`The command must be a string: ${String(command)}.`);
	const trimmedCommand = command.trim();
	if (trimmedCommand === "") return [];
	const tokens = [];
	for (const token of trimmedCommand.split(SPACES_REGEXP)) {
		const previousToken = tokens.at(-1);
		if (previousToken && previousToken.endsWith("\\")) tokens[tokens.length - 1] = `${previousToken.slice(0, -1)} ${token}`;
		else tokens.push(token);
	}
	return tokens;
};
const SPACES_REGEXP = / +/g;

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/lib/methods/script.js
const setScriptSync = (boundExeca, createNested, boundOptions) => {
	boundExeca.sync = createNested(mapScriptSync, boundOptions);
	boundExeca.s = boundExeca.sync;
};
const mapScriptAsync = ({ options }) => getScriptOptions(options);
const mapScriptSync = ({ options }) => ({
	...getScriptOptions(options),
	isSync: true
});
const getScriptOptions = (options) => ({ options: {
	...getScriptStdinOption(options),
	...options
} });
const getScriptStdinOption = ({ input, inputFile, stdio }) => input === void 0 && inputFile === void 0 && stdio === void 0 ? { stdin: "inherit" } : {};
const deepScriptOptions = { preferLocal: true };

//#endregion
//#region ../../node_modules/.pnpm/execa@9.6.1/node_modules/execa/index.js
const execa = createExeca(() => ({}));
const execaSync = createExeca(() => ({ isSync: true }));
const execaCommand = createExeca(mapCommandAsync);
const execaCommandSync = createExeca(mapCommandSync);
const execaNode = createExeca(mapNode);
const $ = createExeca(mapScriptAsync, {}, deepScriptOptions, setScriptSync);
const { sendMessage, getOneMessage, getEachMessage, getCancelSignal } = getIpcExport();

//#endregion
//#region ../core/src/proc/runner.ts
const SIGNAL_KILLED_EXIT_CODE = 1;
const TIMEOUT_EXIT_CODE = 124;
const cwdOpt = (cwd) => {
	if (cwd === void 0) return {};
	return { cwd };
};
const timeoutOpt = (timeoutMs) => {
	if (timeoutMs === void 0) return {};
	return { timeout: timeoutMs };
};
const withTimeoutNote = (stderr, timeoutMs) => {
	return [stderr, `refs: command timed out after ${String(timeoutMs)}ms`].filter((part) => part !== "").join("\n");
};
const normalizeTimedOutResult = (stderr, timeoutMs) => ({
	exitCode: 124,
	stderr: withTimeoutNote(stderr, timeoutMs),
	stdout: "",
	timedOut: true
});
var ExecaRunner = class {
	async run(cmd, args, opts) {
		const result = await execa(cmd, args, {
			...cwdOpt(opts?.cwd),
			...timeoutOpt(opts?.timeoutMs),
			reject: false
		});
		if (result.timedOut) return normalizeTimedOutResult(result.stderr, opts?.timeoutMs);
		return {
			exitCode: result.exitCode ?? SIGNAL_KILLED_EXIT_CODE,
			stderr: result.stderr,
			stdout: result.stdout
		};
	}
};

//#endregion
//#region ../core/src/schemas/proposal.ts
const MIN_LENGTH$1 = 1;
const zPackageEntryPartial = zPackageEntry.partial({ description: true });
const zProposalBase = strictObject({
	default_branch: string().min(MIN_LENGTH$1),
	key: zRefKey,
	tag_format_candidate: zTagFormat.nullable(),
	url: string().min(MIN_LENGTH$1)
});
const zProposal = zProposalBase.extend({
	description: string().default(""),
	packages: zSafePackagesRecord(zPackageEntryPartial)
});
const zFinalProposal = zProposalBase.extend({
	description: string().min(MIN_LENGTH$1),
	packages: zSafePackagesRecord(zPackageEntry)
});

//#endregion
//#region ../core/src/schemas/state.ts
const MIN_LENGTH = 1;
const zRefState = strictObject({
	effective_clone_mode: zCloneMode.optional(),
	head_sha: string().regex(/^[0-9a-f]{40}$/u, "head_sha must be a 40-character lowercase hex string").optional(),
	last_error: string().optional(),
	last_fetched_at: datetime().optional(),
	pending_proposal_at: datetime().optional()
});
const STATE_KEY_ISSUE_MESSAGE = "state ref key must be non-empty and not \"__proto__\", \"constructor\", or \"prototype\"";
const zStateRefs = withValidatedKeys((key) => key.length >= MIN_LENGTH && !DANGEROUS_RECORD_KEYS.has(key), () => STATE_KEY_ISSUE_MESSAGE, record(string(), zRefState));
const zState = strictObject({ refs: zStateRefs.default({}) });

//#endregion
//#region ../core/src/settings.ts
const resolveSetting = (key, ref, settings) => ref?.[key] ?? settings[key];

//#endregion
//#region ../core/src/state-io.ts
const JSON_INDENT = 2;
const readStateTextOrAbsent = async (home) => {
	try {
		return await readFile(home.statePath, "utf8");
	} catch (error) {
		if (isEnoent(error)) return;
		throw error;
	}
};
const tryParseJson = (text) => {
	try {
		return JSON.parse(text);
	} catch {
		return;
	}
};
const readState = async (home) => {
	const text = await readStateTextOrAbsent(home);
	if (text === void 0) return zState.parse({});
	const raw = tryParseJson(text);
	if (raw === void 0) return zState.parse({});
	const result = zState.safeParse(raw);
	if (result.success) return result.data;
	return zState.parse({});
};
const writeState = async (home, state) => {
	const result = zState.safeParse(state);
	if (!result.success) throw validationError(prettifyError(result.error));
	await writeFileAtomic(home.statePath, `${JSON.stringify(result.data, void 0, JSON_INDENT)}\n`);
};

//#endregion
//#region ../core/src/workspaces-parse.ts
const EMPTY_STRING$1 = "";
const LIST_ITEM_PATTERN = /^\s*-\s+["']?(?<pattern>[^"'#]+)["']?/u;
const PACKAGES_HEADER_PATTERN = /^packages:\s*(?:#.*)?$/u;
const isPlainObject = (value) => typeof value === "object" && value !== null && !Array.isArray(value);
const parseNpmWorkspaces = (workspacesField) => {
	if (Array.isArray(workspacesField)) return workspacesField.filter((item) => typeof item === "string");
	if (!isPlainObject(workspacesField)) return [];
	const { packages } = workspacesField;
	if (!Array.isArray(packages)) return [];
	return packages.filter((item) => typeof item === "string");
};
const collectPnpmPatterns = (lines) => {
	const patterns = [];
	let inPackages = false;
	for (const line of lines) {
		const trimmed = line.trim();
		if (PACKAGES_HEADER_PATTERN.test(line)) {
			inPackages = true;
			continue;
		}
		if (!inPackages) continue;
		if (trimmed && !trimmed.startsWith("-") && trimmed.includes(":")) break;
		if (!trimmed.startsWith("-")) continue;
		const patternValue = LIST_ITEM_PATTERN.exec(line)?.groups?.["pattern"]?.trim();
		if (patternValue && patternValue !== EMPTY_STRING$1) patterns.push(patternValue);
	}
	return patterns;
};
const extractPackageName = (data) => {
	const { name } = data;
	if (typeof name === "string") return name;
};
const extractPackageDescription = (data) => {
	const { description } = data;
	if (typeof description === "string") return description;
};

//#endregion
//#region ../core/src/workspaces.ts
const GLOB_SUFFIX = "/*";
const BARE_GLOB = "*";
const EMPTY_STRING = "";
const CURRENT_DIR_SEGMENT = ".";
const PARENT_DIR_SEGMENT = "..";
const PATH_SEGMENT_SEPARATOR_PATTERN = /[/\\]/u;
const ZERO = 0;
const ONE = 1;
const isSafeWorkspacePattern = (pattern) => {
	if (isAbsolute(pattern)) return false;
	return pattern.split(PATH_SEGMENT_SEPARATOR_PATTERN).every((segment) => segment !== CURRENT_DIR_SEGMENT && segment !== PARENT_DIR_SEGMENT);
};
const isContainedInRepo = async (repoDir, targetPath, allowSelf = false) => {
	try {
		const rel = relative(await realpath(repoDir), await realpath(targetPath));
		if (allowSelf && rel === EMPTY_STRING) return true;
		const isParentOrAbove = rel === PARENT_DIR_SEGMENT || rel.startsWith(PARENT_DIR_SEGMENT + sep);
		return rel !== EMPTY_STRING && !isParentOrAbove && !isAbsolute(rel);
	} catch {
		return false;
	}
};
const hasPackageJson = async (repoDir, dirPath) => {
	try {
		const pkgJsonPath = join(dirPath, "package.json");
		if (!await isContainedInRepo(repoDir, pkgJsonPath)) return false;
		await readFile(pkgJsonPath, "utf8");
		return true;
	} catch {
		return false;
	}
};
const expandGlobSingleLevel = async (repoDir, baseDir) => {
	try {
		const fullPath = join(repoDir, baseDir);
		if (!await isContainedInRepo(repoDir, fullPath, baseDir === CURRENT_DIR_SEGMENT)) return [];
		const checkPromises = (await readdir(fullPath, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map(async (entry) => {
			if (!await hasPackageJson(repoDir, join(fullPath, entry.name))) return;
			return join(baseDir, entry.name);
		});
		return (await Promise.all(checkPromises)).filter((result) => result !== void 0);
	} catch {
		return [];
	}
};
const expandGlobPattern = async (repoDir, pattern) => {
	if (!isSafeWorkspacePattern(pattern)) return [];
	if (pattern.startsWith("!") || pattern.includes("**")) return [];
	if ((pattern.match(/\*/gu) ?? []).length > ONE) return [];
	if (pattern.endsWith(GLOB_SUFFIX)) {
		const baseDir = pattern.slice(ZERO, -2);
		return expandGlobSingleLevel(repoDir, baseDir);
	}
	if (pattern === BARE_GLOB) return expandGlobSingleLevel(repoDir, CURRENT_DIR_SEGMENT);
	if (!pattern.includes("*")) {
		const dirPath = join(repoDir, pattern);
		if (await isContainedInRepo(repoDir, dirPath) && await hasPackageJson(repoDir, dirPath)) return [pattern];
	}
	return [];
};
const readPackageInfo = async (repoDir, packageDir) => {
	try {
		const pkgJsonPath = join(packageDir, "package.json");
		if (!await isContainedInRepo(repoDir, pkgJsonPath)) return;
		const content = await readFile(pkgJsonPath, "utf8");
		const data = JSON.parse(content);
		return {
			description: extractPackageDescription(data),
			name: extractPackageName(data)
		};
	} catch {
		return;
	}
};
const deduplicateAndSort = (packages) => {
	const mapEntries = packages.map((pkg) => [pkg.path, pkg]);
	const deduped = [...new Map(mapEntries).values()];
	deduped.sort((packageA, packageB) => packageA.path.localeCompare(packageB.path));
	return deduped;
};
const collectNpmPatterns = async (repoDir, packageJsonPath) => {
	const patterns = /* @__PURE__ */ new Set();
	try {
		if (!await isContainedInRepo(repoDir, packageJsonPath)) return patterns;
		const npmContent = await readFile(packageJsonPath, "utf8");
		parseNpmWorkspaces(JSON.parse(npmContent)["workspaces"]).forEach((pattern) => patterns.add(pattern));
	} catch {}
	return patterns;
};
const collectPnpmPatternsFromFile = async (repoDir, pnpmWorkspacePath) => {
	const patterns = /* @__PURE__ */ new Set();
	try {
		if (!await isContainedInRepo(repoDir, pnpmWorkspacePath)) return patterns;
		collectPnpmPatterns((await readFile(pnpmWorkspacePath, "utf8")).split("\n")).forEach((pattern) => patterns.add(pattern));
	} catch {}
	return patterns;
};
const expandPatterns = async (repoDir, patterns) => {
	const packageDirs = /* @__PURE__ */ new Set();
	const expandPromises = [...patterns].map((pattern) => expandGlobPattern(repoDir, pattern));
	(await Promise.all(expandPromises)).forEach((expanded) => {
		expanded.forEach((dir) => packageDirs.add(dir));
	});
	return packageDirs;
};
const processSinglePackageDir = async (repoDir, packageDir) => {
	const fullPath = join(repoDir, packageDir);
	if (!await isContainedInRepo(repoDir, fullPath)) return;
	const info = await readPackageInfo(repoDir, fullPath);
	if (!info?.name) return;
	return {
		description: info.description,
		name: info.name,
		path: packageDir
	};
};
const processAllPackageDirs = async (repoDir, packageDirs) => {
	const processPromises = [...packageDirs].map((packageDir) => processSinglePackageDir(repoDir, packageDir));
	return (await Promise.all(processPromises)).filter((pkg) => pkg !== void 0);
};
const detectWorkspacePackages = async (repoDir) => {
	const packageJsonPath = join(repoDir, "package.json");
	const pnpmWorkspacePath = join(repoDir, "pnpm-workspace.yaml");
	const npmPatterns = await collectNpmPatterns(repoDir, packageJsonPath);
	const pnpmPatternsSet = await collectPnpmPatternsFromFile(repoDir, pnpmWorkspacePath);
	const patterns = /* @__PURE__ */ new Set();
	npmPatterns.forEach((pattern) => patterns.add(pattern));
	pnpmPatternsSet.forEach((pattern) => patterns.add(pattern));
	if (patterns.size === ZERO) return [];
	const packageDirs = await expandPatterns(repoDir, patterns);
	const packages = await processAllPackageDirs(repoDir, packageDirs);
	return deduplicateAndSort(packages);
};

//#endregion
//#region src/context.ts
const readRealStdin = async () => {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks).toString("utf8");
};
const realContext = () => ({
	env: process.env,
	errLine: (line) => {
		process.stderr.write(`${line}\n`);
	},
	fetcher: (url) => fetch(url),
	nodeVersion: process.version,
	out: (line) => {
		process.stdout.write(`${line}\n`);
	},
	readStdin: readRealStdin,
	runner: new ExecaRunner()
});

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/error.js
/**
* CommanderError class
*/
var CommanderError = class extends Error {
	/**
	* Constructs the CommanderError class
	* @param {number} exitCode suggested exit code which could be used with process.exit
	* @param {string} code an id string representing the error
	* @param {string} message human-readable description of the error
	*/
	constructor(exitCode, code, message) {
		super(message);
		Error.captureStackTrace(this, this.constructor);
		this.name = this.constructor.name;
		this.code = code;
		this.exitCode = exitCode;
		this.nestedError = void 0;
	}
};
/**
* InvalidArgumentError class
*/
var InvalidArgumentError = class extends CommanderError {
	/**
	* Constructs the InvalidArgumentError class
	* @param {string} [message] explanation of why argument is invalid
	*/
	constructor(message) {
		super(1, "commander.invalidArgument", message);
		Error.captureStackTrace(this, this.constructor);
		this.name = this.constructor.name;
	}
};

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/argument.js
var Argument = class {
	/**
	* Initialize a new command argument with the given name and description.
	* The default is that the argument is required, and you can explicitly
	* indicate this with <> around the name. Put [] around the name for an optional argument.
	*
	* @param {string} name
	* @param {string} [description]
	*/
	constructor(name, description) {
		this.description = description || "";
		this.variadic = false;
		this.parseArg = void 0;
		this.defaultValue = void 0;
		this.defaultValueDescription = void 0;
		this.argChoices = void 0;
		switch (name[0]) {
			case "<":
				this.required = true;
				this._name = name.slice(1, -1);
				break;
			case "[":
				this.required = false;
				this._name = name.slice(1, -1);
				break;
			default:
				this.required = true;
				this._name = name;
				break;
		}
		if (this._name.endsWith("...")) {
			this.variadic = true;
			this._name = this._name.slice(0, -3);
		}
	}
	/**
	* Return argument name.
	*
	* @return {string}
	*/
	name() {
		return this._name;
	}
	/**
	* @package
	*/
	_collectValue(value, previous) {
		if (previous === this.defaultValue || !Array.isArray(previous)) return [value];
		previous.push(value);
		return previous;
	}
	/**
	* Set the default value, and optionally supply the description to be displayed in the help.
	*
	* @param {*} value
	* @param {string} [description]
	* @return {Argument}
	*/
	default(value, description) {
		this.defaultValue = value;
		this.defaultValueDescription = description;
		return this;
	}
	/**
	* Set the custom handler for processing CLI command arguments into argument values.
	*
	* @param {Function} [fn]
	* @return {Argument}
	*/
	argParser(fn) {
		this.parseArg = fn;
		return this;
	}
	/**
	* Only allow argument value to be one of choices.
	*
	* @param {string[]} values
	* @return {Argument}
	*/
	choices(values) {
		this.argChoices = values.slice();
		this.parseArg = (arg, previous) => {
			if (!this.argChoices.includes(arg)) throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
			if (this.variadic) return this._collectValue(arg, previous);
			return arg;
		};
		return this;
	}
	/**
	* Make argument required.
	*
	* @returns {Argument}
	*/
	argRequired() {
		this.required = true;
		return this;
	}
	/**
	* Make argument optional.
	*
	* @returns {Argument}
	*/
	argOptional() {
		this.required = false;
		return this;
	}
};
/**
* Takes an argument and returns its human readable equivalent for help usage.
*
* @param {Argument} arg
* @return {string}
* @private
*/
function humanReadableArgName(arg) {
	const nameOutput = arg.name() + (arg.variadic === true ? "..." : "");
	return arg.required ? "<" + nameOutput + ">" : "[" + nameOutput + "]";
}

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/help.js
/**
* TypeScript import types for JSDoc, used by Visual Studio Code IntelliSense and `npm run typescript-checkJS`
* https://www.typescriptlang.org/docs/handbook/jsdoc-supported-types.html#import-types
* @typedef { import("./argument.js").Argument } Argument
* @typedef { import("./command.js").Command } Command
* @typedef { import("./option.js").Option } Option
*/
var Help = class {
	constructor() {
		this.helpWidth = void 0;
		this.minWidthToWrap = 40;
		this.sortSubcommands = false;
		this.sortOptions = false;
		this.showGlobalOptions = false;
	}
	/**
	* prepareContext is called by Commander after applying overrides from `Command.configureHelp()`
	* and just before calling `formatHelp()`.
	*
	* Commander just uses the helpWidth and the rest is provided for optional use by more complex subclasses.
	*
	* @param {{ error?: boolean, helpWidth?: number, outputHasColors?: boolean }} contextOptions
	*/
	prepareContext(contextOptions) {
		this.helpWidth = this.helpWidth ?? contextOptions.helpWidth ?? 80;
	}
	/**
	* Get an array of the visible subcommands. Includes a placeholder for the implicit help command, if there is one.
	*
	* @param {Command} cmd
	* @returns {Command[]}
	*/
	visibleCommands(cmd) {
		const visibleCommands = cmd.commands.filter((cmd) => !cmd._hidden);
		const helpCommand = cmd._getHelpCommand();
		if (helpCommand && !helpCommand._hidden) visibleCommands.push(helpCommand);
		if (this.sortSubcommands) visibleCommands.sort((a, b) => {
			return a.name().localeCompare(b.name());
		});
		return visibleCommands;
	}
	/**
	* Compare options for sort.
	*
	* @param {Option} a
	* @param {Option} b
	* @returns {number}
	*/
	compareOptions(a, b) {
		const getSortKey = (option) => {
			return option.short ? option.short.replace(/^-/, "") : option.long.replace(/^--/, "");
		};
		return getSortKey(a).localeCompare(getSortKey(b));
	}
	/**
	* Get an array of the visible options. Includes a placeholder for the implicit help option, if there is one.
	*
	* @param {Command} cmd
	* @returns {Option[]}
	*/
	visibleOptions(cmd) {
		const visibleOptions = cmd.options.filter((option) => !option.hidden);
		const helpOption = cmd._getHelpOption();
		if (helpOption && !helpOption.hidden) {
			const removeShort = helpOption.short && cmd._findOption(helpOption.short);
			const removeLong = helpOption.long && cmd._findOption(helpOption.long);
			if (!removeShort && !removeLong) visibleOptions.push(helpOption);
			else if (helpOption.long && !removeLong) visibleOptions.push(cmd.createOption(helpOption.long, helpOption.description));
			else if (helpOption.short && !removeShort) visibleOptions.push(cmd.createOption(helpOption.short, helpOption.description));
		}
		if (this.sortOptions) visibleOptions.sort(this.compareOptions);
		return visibleOptions;
	}
	/**
	* Get an array of the visible global options. (Not including help.)
	*
	* @param {Command} cmd
	* @returns {Option[]}
	*/
	visibleGlobalOptions(cmd) {
		if (!this.showGlobalOptions) return [];
		const globalOptions = [];
		for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) {
			const visibleOptions = ancestorCmd.options.filter((option) => !option.hidden);
			globalOptions.push(...visibleOptions);
		}
		if (this.sortOptions) globalOptions.sort(this.compareOptions);
		return globalOptions;
	}
	/**
	* Get an array of the arguments if any have a description.
	*
	* @param {Command} cmd
	* @returns {Argument[]}
	*/
	visibleArguments(cmd) {
		if (cmd._argsDescription) cmd.registeredArguments.forEach((argument) => {
			argument.description = argument.description || cmd._argsDescription[argument.name()] || "";
		});
		if (cmd.registeredArguments.find((argument) => argument.description)) return cmd.registeredArguments;
		return [];
	}
	/**
	* Get the command term to show in the list of subcommands.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	subcommandTerm(cmd) {
		const args = cmd.registeredArguments.map((arg) => humanReadableArgName(arg)).join(" ");
		return cmd._name + (cmd._aliases[0] ? "|" + cmd._aliases[0] : "") + (cmd.options.length ? " [options]" : "") + (args ? " " + args : "");
	}
	/**
	* Get the option term to show in the list of options.
	*
	* @param {Option} option
	* @returns {string}
	*/
	optionTerm(option) {
		return option.flags;
	}
	/**
	* Get the argument term to show in the list of arguments.
	*
	* @param {Argument} argument
	* @returns {string}
	*/
	argumentTerm(argument) {
		return argument.name();
	}
	/**
	* Get the longest command term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestSubcommandTermLength(cmd, helper) {
		return helper.visibleCommands(cmd).reduce((max, command) => {
			return Math.max(max, this.displayWidth(helper.styleSubcommandTerm(helper.subcommandTerm(command))));
		}, 0);
	}
	/**
	* Get the longest option term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestOptionTermLength(cmd, helper) {
		return helper.visibleOptions(cmd).reduce((max, option) => {
			return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
		}, 0);
	}
	/**
	* Get the longest global option term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestGlobalOptionTermLength(cmd, helper) {
		return helper.visibleGlobalOptions(cmd).reduce((max, option) => {
			return Math.max(max, this.displayWidth(helper.styleOptionTerm(helper.optionTerm(option))));
		}, 0);
	}
	/**
	* Get the longest argument term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	longestArgumentTermLength(cmd, helper) {
		return helper.visibleArguments(cmd).reduce((max, argument) => {
			return Math.max(max, this.displayWidth(helper.styleArgumentTerm(helper.argumentTerm(argument))));
		}, 0);
	}
	/**
	* Get the command usage to be displayed at the top of the built-in help.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	commandUsage(cmd) {
		let cmdName = cmd._name;
		if (cmd._aliases[0]) cmdName = cmdName + "|" + cmd._aliases[0];
		let ancestorCmdNames = "";
		for (let ancestorCmd = cmd.parent; ancestorCmd; ancestorCmd = ancestorCmd.parent) ancestorCmdNames = ancestorCmd.name() + " " + ancestorCmdNames;
		return ancestorCmdNames + cmdName + " " + cmd.usage();
	}
	/**
	* Get the description for the command.
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	commandDescription(cmd) {
		return cmd.description();
	}
	/**
	* Get the subcommand summary to show in the list of subcommands.
	* (Fallback to description for backwards compatibility.)
	*
	* @param {Command} cmd
	* @returns {string}
	*/
	subcommandDescription(cmd) {
		return cmd.summary() || cmd.description();
	}
	/**
	* Get the option description to show in the list of options.
	*
	* @param {Option} option
	* @return {string}
	*/
	optionDescription(option) {
		const extraInfo = [];
		if (option.argChoices) extraInfo.push(`choices: ${option.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
		if (option.defaultValue !== void 0) {
			if (option.required || option.optional || option.isBoolean() && typeof option.defaultValue === "boolean") extraInfo.push(`default: ${option.defaultValueDescription || JSON.stringify(option.defaultValue)}`);
		}
		if (option.presetArg !== void 0 && option.optional) extraInfo.push(`preset: ${JSON.stringify(option.presetArg)}`);
		if (option.envVar !== void 0) extraInfo.push(`env: ${option.envVar}`);
		if (extraInfo.length > 0) {
			const extraDescription = `(${extraInfo.join(", ")})`;
			if (option.description) return `${option.description} ${extraDescription}`;
			return extraDescription;
		}
		return option.description;
	}
	/**
	* Get the argument description to show in the list of arguments.
	*
	* @param {Argument} argument
	* @return {string}
	*/
	argumentDescription(argument) {
		const extraInfo = [];
		if (argument.argChoices) extraInfo.push(`choices: ${argument.argChoices.map((choice) => JSON.stringify(choice)).join(", ")}`);
		if (argument.defaultValue !== void 0) extraInfo.push(`default: ${argument.defaultValueDescription || JSON.stringify(argument.defaultValue)}`);
		if (extraInfo.length > 0) {
			const extraDescription = `(${extraInfo.join(", ")})`;
			if (argument.description) return `${argument.description} ${extraDescription}`;
			return extraDescription;
		}
		return argument.description;
	}
	/**
	* Format a list of items, given a heading and an array of formatted items.
	*
	* @param {string} heading
	* @param {string[]} items
	* @param {Help} helper
	* @returns string[]
	*/
	formatItemList(heading, items, helper) {
		if (items.length === 0) return [];
		return [
			helper.styleTitle(heading),
			...items,
			""
		];
	}
	/**
	* Group items by their help group heading.
	*
	* @param {Command[] | Option[]} unsortedItems
	* @param {Command[] | Option[]} visibleItems
	* @param {Function} getGroup
	* @returns {Map<string, Command[] | Option[]>}
	*/
	groupItems(unsortedItems, visibleItems, getGroup) {
		const result = /* @__PURE__ */ new Map();
		unsortedItems.forEach((item) => {
			const group = getGroup(item);
			if (!result.has(group)) result.set(group, []);
		});
		visibleItems.forEach((item) => {
			const group = getGroup(item);
			if (!result.has(group)) result.set(group, []);
			result.get(group).push(item);
		});
		return result;
	}
	/**
	* Generate the built-in help text.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {string}
	*/
	formatHelp(cmd, helper) {
		const termWidth = helper.padWidth(cmd, helper);
		const helpWidth = helper.helpWidth ?? 80;
		function callFormatItem(term, description) {
			return helper.formatItem(term, termWidth, description, helper);
		}
		let output = [`${helper.styleTitle("Usage:")} ${helper.styleUsage(helper.commandUsage(cmd))}`, ""];
		const commandDescription = helper.commandDescription(cmd);
		if (commandDescription.length > 0) output = output.concat([helper.boxWrap(helper.styleCommandDescription(commandDescription), helpWidth), ""]);
		const argumentList = helper.visibleArguments(cmd).map((argument) => {
			return callFormatItem(helper.styleArgumentTerm(helper.argumentTerm(argument)), helper.styleArgumentDescription(helper.argumentDescription(argument)));
		});
		output = output.concat(this.formatItemList("Arguments:", argumentList, helper));
		this.groupItems(cmd.options, helper.visibleOptions(cmd), (option) => option.helpGroupHeading ?? "Options:").forEach((options, group) => {
			const optionList = options.map((option) => {
				return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
			});
			output = output.concat(this.formatItemList(group, optionList, helper));
		});
		if (helper.showGlobalOptions) {
			const globalOptionList = helper.visibleGlobalOptions(cmd).map((option) => {
				return callFormatItem(helper.styleOptionTerm(helper.optionTerm(option)), helper.styleOptionDescription(helper.optionDescription(option)));
			});
			output = output.concat(this.formatItemList("Global Options:", globalOptionList, helper));
		}
		this.groupItems(cmd.commands, helper.visibleCommands(cmd), (sub) => sub.helpGroup() || "Commands:").forEach((commands, group) => {
			const commandList = commands.map((sub) => {
				return callFormatItem(helper.styleSubcommandTerm(helper.subcommandTerm(sub)), helper.styleSubcommandDescription(helper.subcommandDescription(sub)));
			});
			output = output.concat(this.formatItemList(group, commandList, helper));
		});
		return output.join("\n");
	}
	/**
	* Return display width of string, ignoring ANSI escape sequences. Used in padding and wrapping calculations.
	*
	* @param {string} str
	* @returns {number}
	*/
	displayWidth(str) {
		return stripVTControlCharacters(str).length;
	}
	/**
	* Style the title for displaying in the help. Called with 'Usage:', 'Options:', etc.
	*
	* @param {string} str
	* @returns {string}
	*/
	styleTitle(str) {
		return str;
	}
	styleUsage(str) {
		return str.split(" ").map((word) => {
			if (word === "[options]") return this.styleOptionText(word);
			if (word === "[command]") return this.styleSubcommandText(word);
			if (word[0] === "[" || word[0] === "<") return this.styleArgumentText(word);
			return this.styleCommandText(word);
		}).join(" ");
	}
	styleCommandDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleOptionDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleSubcommandDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleArgumentDescription(str) {
		return this.styleDescriptionText(str);
	}
	styleDescriptionText(str) {
		return str;
	}
	styleOptionTerm(str) {
		return this.styleOptionText(str);
	}
	styleSubcommandTerm(str) {
		return str.split(" ").map((word) => {
			if (word === "[options]") return this.styleOptionText(word);
			if (word[0] === "[" || word[0] === "<") return this.styleArgumentText(word);
			return this.styleSubcommandText(word);
		}).join(" ");
	}
	styleArgumentTerm(str) {
		return this.styleArgumentText(str);
	}
	styleOptionText(str) {
		return str;
	}
	styleArgumentText(str) {
		return str;
	}
	styleSubcommandText(str) {
		return str;
	}
	styleCommandText(str) {
		return str;
	}
	/**
	* Calculate the pad width from the maximum term length.
	*
	* @param {Command} cmd
	* @param {Help} helper
	* @returns {number}
	*/
	padWidth(cmd, helper) {
		return Math.max(helper.longestOptionTermLength(cmd, helper), helper.longestGlobalOptionTermLength(cmd, helper), helper.longestSubcommandTermLength(cmd, helper), helper.longestArgumentTermLength(cmd, helper));
	}
	/**
	* Detect manually wrapped and indented strings by checking for line break followed by whitespace.
	*
	* @param {string} str
	* @returns {boolean}
	*/
	preformatted(str) {
		return /\n[^\S\r\n]/.test(str);
	}
	/**
	* Format the "item", which consists of a term and description. Pad the term and wrap the description, indenting the following lines.
	*
	* So "TTT", 5, "DDD DDDD DD DDD" might be formatted for this.helpWidth=17 like so:
	*   TTT  DDD DDDD
	*        DD DDD
	*
	* @param {string} term
	* @param {number} termWidth
	* @param {string} description
	* @param {Help} helper
	* @returns {string}
	*/
	formatItem(term, termWidth, description, helper) {
		const itemIndent = 2;
		const itemIndentStr = " ".repeat(itemIndent);
		if (!description) return itemIndentStr + term;
		const paddedTerm = term.padEnd(termWidth + term.length - helper.displayWidth(term));
		const spacerWidth = 2;
		const remainingWidth = (this.helpWidth ?? 80) - termWidth - spacerWidth - itemIndent;
		let formattedDescription;
		if (remainingWidth < this.minWidthToWrap || helper.preformatted(description)) formattedDescription = description;
		else formattedDescription = helper.boxWrap(description, remainingWidth).replace(/\n/g, "\n" + " ".repeat(termWidth + spacerWidth));
		return itemIndentStr + paddedTerm + " ".repeat(spacerWidth) + formattedDescription.replace(/\n/g, `\n${itemIndentStr}`);
	}
	/**
	* Wrap a string at whitespace, preserving existing line breaks.
	* Wrapping is skipped if the width is less than `minWidthToWrap`.
	*
	* @param {string} str
	* @param {number} width
	* @returns {string}
	*/
	boxWrap(str, width) {
		if (width < this.minWidthToWrap) return str;
		const rawLines = str.split(/\r\n|\n/);
		const chunkPattern = /[\s]*[^\s]+/g;
		const wrappedLines = [];
		rawLines.forEach((line) => {
			const chunks = line.match(chunkPattern);
			if (chunks === null) {
				wrappedLines.push("");
				return;
			}
			let sumChunks = [chunks.shift()];
			let sumWidth = this.displayWidth(sumChunks[0]);
			chunks.forEach((chunk) => {
				const visibleWidth = this.displayWidth(chunk);
				if (sumWidth + visibleWidth <= width) {
					sumChunks.push(chunk);
					sumWidth += visibleWidth;
					return;
				}
				wrappedLines.push(sumChunks.join(""));
				const nextChunk = chunk.trimStart();
				sumChunks = [nextChunk];
				sumWidth = this.displayWidth(nextChunk);
			});
			wrappedLines.push(sumChunks.join(""));
		});
		return wrappedLines.join("\n");
	}
};

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/option.js
var Option = class {
	/**
	* Initialize a new `Option` with the given `flags` and `description`.
	*
	* @param {string} flags
	* @param {string} [description]
	*/
	constructor(flags, description) {
		this.flags = flags;
		this.description = description || "";
		this.required = flags.includes("<");
		this.optional = flags.includes("[");
		this.variadic = /\w\.\.\.[>\]]$/.test(flags);
		this.mandatory = false;
		const optionFlags = splitOptionFlags(flags);
		this.short = optionFlags.shortFlag;
		this.long = optionFlags.longFlag;
		this.negate = false;
		if (this.long) this.negate = this.long.startsWith("--no-");
		this.defaultValue = void 0;
		this.defaultValueDescription = void 0;
		this.presetArg = void 0;
		this.envVar = void 0;
		this.parseArg = void 0;
		this.hidden = false;
		this.argChoices = void 0;
		this.conflictsWith = [];
		this.implied = void 0;
		this.helpGroupHeading = void 0;
	}
	/**
	* Set the default value, and optionally supply the description to be displayed in the help.
	*
	* @param {*} value
	* @param {string} [description]
	* @return {Option}
	*/
	default(value, description) {
		this.defaultValue = value;
		this.defaultValueDescription = description;
		return this;
	}
	/**
	* Preset to use when option used without option-argument, especially optional but also boolean and negated.
	* The custom processing (parseArg) is called.
	*
	* @example
	* new Option('--color').default('GREYSCALE').preset('RGB');
	* new Option('--donate [amount]').preset('20').argParser(parseFloat);
	*
	* @param {*} arg
	* @return {Option}
	*/
	preset(arg) {
		this.presetArg = arg;
		return this;
	}
	/**
	* Add option name(s) that conflict with this option.
	* An error will be displayed if conflicting options are found during parsing.
	*
	* @example
	* new Option('--rgb').conflicts('cmyk');
	* new Option('--js').conflicts(['ts', 'jsx']);
	*
	* @param {(string | string[])} names
	* @return {Option}
	*/
	conflicts(names) {
		this.conflictsWith = this.conflictsWith.concat(names);
		return this;
	}
	/**
	* Specify implied option values for when this option is set and the implied options are not.
	*
	* The custom processing (parseArg) is not called on the implied values.
	*
	* @example
	* program
	*   .addOption(new Option('--log', 'write logging information to file'))
	*   .addOption(new Option('--trace', 'log extra details').implies({ log: 'trace.txt' }));
	*
	* @param {object} impliedOptionValues
	* @return {Option}
	*/
	implies(impliedOptionValues) {
		let newImplied = impliedOptionValues;
		if (typeof impliedOptionValues === "string") newImplied = { [impliedOptionValues]: true };
		this.implied = Object.assign(this.implied || {}, newImplied);
		return this;
	}
	/**
	* Set environment variable to check for option value.
	*
	* An environment variable is only used if when processed the current option value is
	* undefined, or the source of the current value is 'default' or 'config' or 'env'.
	*
	* @param {string} name
	* @return {Option}
	*/
	env(name) {
		this.envVar = name;
		return this;
	}
	/**
	* Set the custom handler for processing CLI option arguments into option values.
	*
	* @param {Function} [fn]
	* @return {Option}
	*/
	argParser(fn) {
		this.parseArg = fn;
		return this;
	}
	/**
	* Whether the option is mandatory and must have a value after parsing.
	*
	* @param {boolean} [mandatory=true]
	* @return {Option}
	*/
	makeOptionMandatory(mandatory = true) {
		this.mandatory = !!mandatory;
		return this;
	}
	/**
	* Hide option in help.
	*
	* @param {boolean} [hide=true]
	* @return {Option}
	*/
	hideHelp(hide = true) {
		this.hidden = !!hide;
		return this;
	}
	/**
	* @package
	*/
	_collectValue(value, previous) {
		if (previous === this.defaultValue || !Array.isArray(previous)) return [value];
		previous.push(value);
		return previous;
	}
	/**
	* Only allow option value to be one of choices.
	*
	* @param {string[]} values
	* @return {Option}
	*/
	choices(values) {
		this.argChoices = values.slice();
		this.parseArg = (arg, previous) => {
			if (!this.argChoices.includes(arg)) throw new InvalidArgumentError(`Allowed choices are ${this.argChoices.join(", ")}.`);
			if (this.variadic) return this._collectValue(arg, previous);
			return arg;
		};
		return this;
	}
	/**
	* Return option name.
	*
	* @return {string}
	*/
	name() {
		if (this.long) return this.long.replace(/^--/, "");
		return this.short.replace(/^-/, "");
	}
	/**
	* Return option name, in a camelcase format that can be used
	* as an object attribute key.
	*
	* @return {string}
	*/
	attributeName() {
		if (this.negate) return camelcase(this.name().replace(/^no-/, ""));
		return camelcase(this.name());
	}
	/**
	* Set the help group heading.
	*
	* @param {string} heading
	* @return {Option}
	*/
	helpGroup(heading) {
		this.helpGroupHeading = heading;
		return this;
	}
	/**
	* Check if `arg` matches the short or long flag.
	*
	* @param {string} arg
	* @return {boolean}
	* @package
	*/
	is(arg) {
		return this.short === arg || this.long === arg;
	}
	/**
	* Return whether a boolean option.
	*
	* Options are one of boolean, negated, required argument, or optional argument.
	*
	* @return {boolean}
	* @package
	*/
	isBoolean() {
		return !this.required && !this.optional && !this.negate;
	}
};
/**
* This class is to make it easier to work with dual options, without changing the existing
* implementation. We support separate dual options for separate positive and negative options,
* like `--build` and `--no-build`, which share a single option value. This works nicely for some
* use cases, but is tricky for others where we want separate behaviours despite
* the single shared option value.
*/
var DualOptions = class {
	/**
	* @param {Option[]} options
	*/
	constructor(options) {
		this.positiveOptions = /* @__PURE__ */ new Map();
		this.negativeOptions = /* @__PURE__ */ new Map();
		this.dualOptions = /* @__PURE__ */ new Set();
		options.forEach((option) => {
			if (option.negate) this.negativeOptions.set(option.attributeName(), option);
			else this.positiveOptions.set(option.attributeName(), option);
		});
		this.negativeOptions.forEach((value, key) => {
			if (this.positiveOptions.has(key)) this.dualOptions.add(key);
		});
	}
	/**
	* Did the value come from the option, and not from possible matching dual option?
	*
	* @param {*} value
	* @param {Option} option
	* @returns {boolean}
	*/
	valueFromOption(value, option) {
		const optionKey = option.attributeName();
		if (!this.dualOptions.has(optionKey)) return true;
		const preset = this.negativeOptions.get(optionKey).presetArg;
		const negativeValue = preset !== void 0 ? preset : false;
		return option.negate === (negativeValue === value);
	}
};
/**
* Convert string from kebab-case to camelCase.
*
* @param {string} str
* @return {string}
* @private
*/
function camelcase(str) {
	return str.split("-").reduce((str, word) => {
		return str + word[0].toUpperCase() + word.slice(1);
	});
}
/**
* Split the short and long flag out of something like '-m,--mixed <value>'
*
* @private
*/
function splitOptionFlags(flags) {
	let shortFlag;
	let longFlag;
	const shortFlagExp = /^-[^-]$/;
	const longFlagExp = /^--[^-]/;
	const flagParts = flags.split(/[ |,]+/).concat("guard");
	if (shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
	if (longFlagExp.test(flagParts[0])) longFlag = flagParts.shift();
	if (!shortFlag && shortFlagExp.test(flagParts[0])) shortFlag = flagParts.shift();
	if (!shortFlag && longFlagExp.test(flagParts[0])) {
		shortFlag = longFlag;
		longFlag = flagParts.shift();
	}
	if (flagParts[0].startsWith("-")) {
		const unsupportedFlag = flagParts[0];
		const baseError = `option creation failed due to '${unsupportedFlag}' in option flags '${flags}'`;
		if (/^-[^-][^-]/.test(unsupportedFlag)) throw new Error(`${baseError}
- a short flag is a single dash and a single character
  - either use a single dash and a single character (for a short flag)
  - or use a double dash for a long option (and can have two, like '--ws, --workspace')`);
		if (shortFlagExp.test(unsupportedFlag)) throw new Error(`${baseError}
- too many short flags`);
		if (longFlagExp.test(unsupportedFlag)) throw new Error(`${baseError}
- too many long flags`);
		throw new Error(`${baseError}
- unrecognised flag format`);
	}
	if (shortFlag === void 0 && longFlag === void 0) throw new Error(`option creation failed due to no flags found in '${flags}'.`);
	return {
		shortFlag,
		longFlag
	};
}

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/suggestSimilar.js
const maxDistance = 3;
function editDistance(a, b) {
	if (Math.abs(a.length - b.length) > maxDistance) return Math.max(a.length, b.length);
	const d = [];
	for (let i = 0; i <= a.length; i++) d[i] = [i];
	for (let j = 0; j <= b.length; j++) d[0][j] = j;
	for (let j = 1; j <= b.length; j++) for (let i = 1; i <= a.length; i++) {
		let cost;
		if (a[i - 1] === b[j - 1]) cost = 0;
		else cost = 1;
		d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
		if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
	}
	return d[a.length][b.length];
}
/**
* Find close matches, restricted to same number of edits.
*
* @param {string} word
* @param {string[]} candidates
* @returns {string}
*/
function suggestSimilar(word, candidates) {
	if (!candidates || candidates.length === 0) return "";
	candidates = Array.from(new Set(candidates));
	const searchingOptions = word.startsWith("--");
	if (searchingOptions) {
		word = word.slice(2);
		candidates = candidates.map((candidate) => candidate.slice(2));
	}
	let similar = [];
	let bestDistance = maxDistance;
	const minSimilarity = .4;
	candidates.forEach((candidate) => {
		if (candidate.length <= 1) return;
		const distance = editDistance(word, candidate);
		const length = Math.max(word.length, candidate.length);
		if ((length - distance) / length > minSimilarity) {
			if (distance < bestDistance) {
				bestDistance = distance;
				similar = [candidate];
			} else if (distance === bestDistance) similar.push(candidate);
		}
	});
	similar.sort((a, b) => a.localeCompare(b));
	if (searchingOptions) similar = similar.map((candidate) => `--${candidate}`);
	if (similar.length > 1) return `\n(Did you mean one of ${similar.join(", ")}?)`;
	if (similar.length === 1) return `\n(Did you mean ${similar[0]}?)`;
	return "";
}

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/lib/command.js
var Command = class Command extends EventEmitter {
	/**
	* Initialize a new `Command`.
	*
	* @param {string} [name]
	*/
	constructor(name) {
		super();
		/** @type {Command[]} */
		this.commands = [];
		/** @type {Option[]} */
		this.options = [];
		this.parent = null;
		this._allowUnknownOption = false;
		this._allowExcessArguments = false;
		/** @type {Argument[]} */
		this.registeredArguments = [];
		this._args = this.registeredArguments;
		/** @type {string[]} */
		this.args = [];
		this.rawArgs = [];
		this.processedArgs = [];
		this._scriptPath = null;
		this._name = name || "";
		this._optionValues = {};
		this._optionValueSources = {};
		this._storeOptionsAsProperties = false;
		this._actionHandler = null;
		this._executableHandler = false;
		this._executableFile = null;
		this._executableDir = null;
		this._defaultCommandName = null;
		this._exitCallback = null;
		this._aliases = [];
		this._combineFlagAndOptionalValue = true;
		this._description = "";
		this._summary = "";
		this._argsDescription = void 0;
		this._enablePositionalOptions = false;
		this._passThroughOptions = false;
		this._lifeCycleHooks = {};
		/** @type {(boolean | string)} */
		this._showHelpAfterError = false;
		this._showSuggestionAfterError = true;
		this._savedState = null;
		this._outputConfiguration = {
			writeOut: (str) => process$1.stdout.write(str),
			writeErr: (str) => process$1.stderr.write(str),
			outputError: (str, write) => write(str),
			getOutHelpWidth: () => process$1.stdout.isTTY ? process$1.stdout.columns : void 0,
			getErrHelpWidth: () => process$1.stderr.isTTY ? process$1.stderr.columns : void 0,
			getOutHasColors: () => useColor() ?? (process$1.stdout.isTTY && process$1.stdout.hasColors?.()),
			getErrHasColors: () => useColor() ?? (process$1.stderr.isTTY && process$1.stderr.hasColors?.()),
			stripColor: (str) => stripVTControlCharacters(str)
		};
		this._hidden = false;
		/** @type {(Option | null | undefined)} */
		this._helpOption = void 0;
		this._addImplicitHelpCommand = void 0;
		/** @type {Command} */
		this._helpCommand = void 0;
		this._helpConfiguration = {};
		/** @type {string | undefined} */
		this._helpGroupHeading = void 0;
		/** @type {string | undefined} */
		this._defaultCommandGroup = void 0;
		/** @type {string | undefined} */
		this._defaultOptionGroup = void 0;
	}
	/**
	* Copy settings that are useful to have in common across root command and subcommands.
	*
	* (Used internally when adding a command using `.command()` so subcommands inherit parent settings.)
	*
	* @param {Command} sourceCommand
	* @return {Command} `this` command for chaining
	*/
	copyInheritedSettings(sourceCommand) {
		this._outputConfiguration = sourceCommand._outputConfiguration;
		this._helpOption = sourceCommand._helpOption;
		this._helpCommand = sourceCommand._helpCommand;
		this._helpConfiguration = sourceCommand._helpConfiguration;
		this._exitCallback = sourceCommand._exitCallback;
		this._storeOptionsAsProperties = sourceCommand._storeOptionsAsProperties;
		this._combineFlagAndOptionalValue = sourceCommand._combineFlagAndOptionalValue;
		this._allowExcessArguments = sourceCommand._allowExcessArguments;
		this._enablePositionalOptions = sourceCommand._enablePositionalOptions;
		this._showHelpAfterError = sourceCommand._showHelpAfterError;
		this._showSuggestionAfterError = sourceCommand._showSuggestionAfterError;
		return this;
	}
	/**
	* @returns {Command[]}
	* @private
	*/
	_getCommandAndAncestors() {
		const result = [];
		for (let command = this; command; command = command.parent) result.push(command);
		return result;
	}
	/**
	* Define a command.
	*
	* There are two styles of command: pay attention to where to put the description.
	*
	* @example
	* // Command implemented using action handler (description is supplied separately to `.command`)
	* program
	*   .command('clone <source> [destination]')
	*   .description('clone a repository into a newly created directory')
	*   .action((source, destination) => {
	*     console.log('clone command called');
	*   });
	*
	* // Command implemented using separate executable file (description is second parameter to `.command`)
	* program
	*   .command('start <service>', 'start named service')
	*   .command('stop [service]', 'stop named service, or all if no name supplied');
	*
	* @param {string} nameAndArgs - command name and arguments, args are `<required>` or `[optional]` and last may also be `variadic...`
	* @param {(object | string)} [actionOptsOrExecDesc] - configuration options (for action), or description (for executable)
	* @param {object} [execOpts] - configuration options (for executable)
	* @return {Command} returns new command for action handler, or `this` for executable command
	*/
	command(nameAndArgs, actionOptsOrExecDesc, execOpts) {
		let desc = actionOptsOrExecDesc;
		let opts = execOpts;
		if (typeof desc === "object" && desc !== null) {
			opts = desc;
			desc = null;
		}
		opts = opts || {};
		const [, name, args] = nameAndArgs.match(/([^ ]+) *(.*)/);
		const cmd = this.createCommand(name);
		if (desc) {
			cmd.description(desc);
			cmd._executableHandler = true;
		}
		if (opts.isDefault) this._defaultCommandName = cmd._name;
		cmd._hidden = !!(opts.noHelp || opts.hidden);
		cmd._executableFile = opts.executableFile || null;
		if (args) cmd.arguments(args);
		this._registerCommand(cmd);
		cmd.parent = this;
		cmd.copyInheritedSettings(this);
		if (desc) return this;
		return cmd;
	}
	/**
	* Factory routine to create a new unattached command.
	*
	* See .command() for creating an attached subcommand, which uses this routine to
	* create the command. You can override createCommand to customise subcommands.
	*
	* @param {string} [name]
	* @return {Command} new command
	*/
	createCommand(name) {
		return new Command(name);
	}
	/**
	* You can customise the help with a subclass of Help by overriding createHelp,
	* or by overriding Help properties using configureHelp().
	*
	* @return {Help}
	*/
	createHelp() {
		return Object.assign(new Help(), this.configureHelp());
	}
	/**
	* You can customise the help by overriding Help properties using configureHelp(),
	* or with a subclass of Help by overriding createHelp().
	*
	* @param {object} [configuration] - configuration options
	* @return {(Command | object)} `this` command for chaining, or stored configuration
	*/
	configureHelp(configuration) {
		if (configuration === void 0) return this._helpConfiguration;
		this._helpConfiguration = configuration;
		return this;
	}
	/**
	* The default output goes to stdout and stderr. You can customise this for special
	* applications. You can also customise the display of errors by overriding outputError.
	*
	* The configuration properties are all functions:
	*
	*     // change how output being written, defaults to stdout and stderr
	*     writeOut(str)
	*     writeErr(str)
	*     // change how output being written for errors, defaults to writeErr
	*     outputError(str, write) // used for displaying errors and not used for displaying help
	*     // specify width for wrapping help
	*     getOutHelpWidth()
	*     getErrHelpWidth()
	*     // color support, currently only used with Help
	*     getOutHasColors()
	*     getErrHasColors()
	*     stripColor() // used to remove ANSI escape codes if output does not have colors
	*
	* @param {object} [configuration] - configuration options
	* @return {(Command | object)} `this` command for chaining, or stored configuration
	*/
	configureOutput(configuration) {
		if (configuration === void 0) return this._outputConfiguration;
		this._outputConfiguration = {
			...this._outputConfiguration,
			...configuration
		};
		return this;
	}
	/**
	* Display the help or a custom message after an error occurs.
	*
	* @param {(boolean|string)} [displayHelp]
	* @return {Command} `this` command for chaining
	*/
	showHelpAfterError(displayHelp = true) {
		if (typeof displayHelp !== "string") displayHelp = !!displayHelp;
		this._showHelpAfterError = displayHelp;
		return this;
	}
	/**
	* Display suggestion of similar commands for unknown commands, or options for unknown options.
	*
	* @param {boolean} [displaySuggestion]
	* @return {Command} `this` command for chaining
	*/
	showSuggestionAfterError(displaySuggestion = true) {
		this._showSuggestionAfterError = !!displaySuggestion;
		return this;
	}
	/**
	* Add a prepared subcommand.
	*
	* See .command() for creating an attached subcommand which inherits settings from its parent.
	*
	* @param {Command} cmd - new subcommand
	* @param {object} [opts] - configuration options
	* @return {Command} `this` command for chaining
	*/
	addCommand(cmd, opts) {
		if (!cmd._name) throw new Error(`Command passed to .addCommand() must have a name
- specify the name in Command constructor or using .name()`);
		opts = opts || {};
		if (opts.isDefault) this._defaultCommandName = cmd._name;
		if (opts.noHelp || opts.hidden) cmd._hidden = true;
		this._registerCommand(cmd);
		cmd.parent = this;
		cmd._checkForBrokenPassThrough();
		return this;
	}
	/**
	* Factory routine to create a new unattached argument.
	*
	* See .argument() for creating an attached argument, which uses this routine to
	* create the argument. You can override createArgument to return a custom argument.
	*
	* @param {string} name
	* @param {string} [description]
	* @return {Argument} new argument
	*/
	createArgument(name, description) {
		return new Argument(name, description);
	}
	/**
	* Define argument syntax for command.
	*
	* The default is that the argument is required, and you can explicitly
	* indicate this with <> around the name. Put [] around the name for an optional argument.
	*
	* @example
	* program.argument('<input-file>');
	* program.argument('[output-file]');
	*
	* @param {string} name
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom argument processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	argument(name, description, parseArg, defaultValue) {
		const argument = this.createArgument(name, description);
		if (typeof parseArg === "function") argument.default(defaultValue).argParser(parseArg);
		else argument.default(parseArg);
		this.addArgument(argument);
		return this;
	}
	/**
	* Define argument syntax for command, adding multiple at once (without descriptions).
	*
	* See also .argument().
	*
	* @example
	* program.arguments('<cmd> [env]');
	*
	* @param {string} names
	* @return {Command} `this` command for chaining
	*/
	arguments(names) {
		names.trim().split(/ +/).forEach((detail) => {
			this.argument(detail);
		});
		return this;
	}
	/**
	* Define argument syntax for command, adding a prepared argument.
	*
	* @param {Argument} argument
	* @return {Command} `this` command for chaining
	*/
	addArgument(argument) {
		const previousArgument = this.registeredArguments.slice(-1)[0];
		if (previousArgument?.variadic) throw new Error(`only the last argument can be variadic '${previousArgument.name()}'`);
		if (argument.required && argument.defaultValue !== void 0 && argument.parseArg === void 0) throw new Error(`a default value for a required argument is never used: '${argument.name()}'`);
		this.registeredArguments.push(argument);
		return this;
	}
	/**
	* Customise or override default help command. By default a help command is automatically added if your command has subcommands.
	*
	* @example
	*    program.helpCommand('help [cmd]');
	*    program.helpCommand('help [cmd]', 'show help');
	*    program.helpCommand(false); // suppress default help command
	*    program.helpCommand(true); // add help command even if no subcommands
	*
	* @param {string|boolean} enableOrNameAndArgs - enable with custom name and/or arguments, or boolean to override whether added
	* @param {string} [description] - custom description
	* @return {Command} `this` command for chaining
	*/
	helpCommand(enableOrNameAndArgs, description) {
		if (typeof enableOrNameAndArgs === "boolean") {
			this._addImplicitHelpCommand = enableOrNameAndArgs;
			if (enableOrNameAndArgs && this._defaultCommandGroup) this._initCommandGroup(this._getHelpCommand());
			return this;
		}
		const [, helpName, helpArgs] = (enableOrNameAndArgs ?? "help [command]").match(/([^ ]+) *(.*)/);
		const helpDescription = description ?? "display help for command";
		const helpCommand = this.createCommand(helpName);
		helpCommand.helpOption(false);
		if (helpArgs) helpCommand.arguments(helpArgs);
		if (helpDescription) helpCommand.description(helpDescription);
		this._addImplicitHelpCommand = true;
		this._helpCommand = helpCommand;
		if (enableOrNameAndArgs || description) this._initCommandGroup(helpCommand);
		return this;
	}
	/**
	* Add prepared custom help command.
	*
	* @param {(Command|string|boolean)} helpCommand - custom help command, or deprecated enableOrNameAndArgs as for `.helpCommand()`
	* @param {string} [deprecatedDescription] - deprecated custom description used with custom name only
	* @return {Command} `this` command for chaining
	*/
	addHelpCommand(helpCommand, deprecatedDescription) {
		if (typeof helpCommand !== "object") {
			this.helpCommand(helpCommand, deprecatedDescription);
			return this;
		}
		this._addImplicitHelpCommand = true;
		this._helpCommand = helpCommand;
		this._initCommandGroup(helpCommand);
		return this;
	}
	/**
	* Lazy create help command.
	*
	* @return {(Command|null)}
	* @package
	*/
	_getHelpCommand() {
		if (this._addImplicitHelpCommand ?? (this.commands.length && !this._actionHandler && !this._findCommand("help"))) {
			if (this._helpCommand === void 0) this.helpCommand(void 0, void 0);
			return this._helpCommand;
		}
		return null;
	}
	/**
	* Add hook for life cycle event.
	*
	* @param {string} event
	* @param {Function} listener
	* @return {Command} `this` command for chaining
	*/
	hook(event, listener) {
		const allowedValues = [
			"preSubcommand",
			"preAction",
			"postAction"
		];
		if (!allowedValues.includes(event)) throw new Error(`Unexpected value for event passed to hook : '${event}'.
Expecting one of '${allowedValues.join("', '")}'`);
		if (this._lifeCycleHooks[event]) this._lifeCycleHooks[event].push(listener);
		else this._lifeCycleHooks[event] = [listener];
		return this;
	}
	/**
	* Register callback to use as replacement for calling process.exit.
	*
	* @param {Function} [fn] optional callback which will be passed a CommanderError, defaults to throwing
	* @return {Command} `this` command for chaining
	*/
	exitOverride(fn) {
		if (fn) this._exitCallback = fn;
		else this._exitCallback = (err) => {
			if (err.code !== "commander.executeSubCommandAsync") throw err;
		};
		return this;
	}
	/**
	* Call process.exit, and _exitCallback if defined.
	*
	* @param {number} exitCode exit code for using with process.exit
	* @param {string} code an id string representing the error
	* @param {string} message human-readable description of the error
	* @return never
	* @private
	*/
	_exit(exitCode, code, message) {
		if (this._exitCallback) this._exitCallback(new CommanderError(exitCode, code, message));
		process$1.exit(exitCode);
	}
	/**
	* Register callback `fn` for the command.
	*
	* @example
	* program
	*   .command('serve')
	*   .description('start service')
	*   .action(function() {
	*      // do work here
	*   });
	*
	* @param {Function} fn
	* @return {Command} `this` command for chaining
	*/
	action(fn) {
		const listener = (args) => {
			const expectedArgsCount = this.registeredArguments.length;
			const actionArgs = args.slice(0, expectedArgsCount);
			if (this._storeOptionsAsProperties) actionArgs[expectedArgsCount] = this;
			else actionArgs[expectedArgsCount] = this.opts();
			actionArgs.push(this);
			return fn.apply(this, actionArgs);
		};
		this._actionHandler = listener;
		return this;
	}
	/**
	* Factory routine to create a new unattached option.
	*
	* See .option() for creating an attached option, which uses this routine to
	* create the option. You can override createOption to return a custom option.
	*
	* @param {string} flags
	* @param {string} [description]
	* @return {Option} new option
	*/
	createOption(flags, description) {
		return new Option(flags, description);
	}
	/**
	* Wrap parseArgs to catch 'commander.invalidArgument'.
	*
	* @param {(Option | Argument)} target
	* @param {string} value
	* @param {*} previous
	* @param {string} invalidArgumentMessage
	* @private
	*/
	_callParseArg(target, value, previous, invalidArgumentMessage) {
		try {
			return target.parseArg(value, previous);
		} catch (err) {
			if (err.code === "commander.invalidArgument") {
				const message = `${invalidArgumentMessage} ${err.message}`;
				this.error(message, {
					exitCode: err.exitCode,
					code: err.code
				});
			}
			throw err;
		}
	}
	/**
	* Check for option flag conflicts.
	* Register option if no conflicts found, or throw on conflict.
	*
	* @param {Option} option
	* @private
	*/
	_registerOption(option) {
		const matchingOption = option.short && this._findOption(option.short) || option.long && this._findOption(option.long);
		if (matchingOption) {
			const matchingFlag = option.long && this._findOption(option.long) ? option.long : option.short;
			throw new Error(`Cannot add option '${option.flags}'${this._name && ` to command '${this._name}'`} due to conflicting flag '${matchingFlag}'
-  already used by option '${matchingOption.flags}'`);
		}
		this._initOptionGroup(option);
		this.options.push(option);
	}
	/**
	* Check for command name and alias conflicts with existing commands.
	* Register command if no conflicts found, or throw on conflict.
	*
	* @param {Command} command
	* @private
	*/
	_registerCommand(command) {
		const knownBy = (cmd) => {
			return [cmd.name()].concat(cmd.aliases());
		};
		const alreadyUsed = knownBy(command).find((name) => this._findCommand(name));
		if (alreadyUsed) {
			const existingCmd = knownBy(this._findCommand(alreadyUsed)).join("|");
			const newCmd = knownBy(command).join("|");
			throw new Error(`cannot add command '${newCmd}' as already have command '${existingCmd}'`);
		}
		this._initCommandGroup(command);
		this.commands.push(command);
	}
	/**
	* Add an option.
	*
	* @param {Option} option
	* @return {Command} `this` command for chaining
	*/
	addOption(option) {
		this._registerOption(option);
		const oname = option.name();
		const name = option.attributeName();
		if (option.defaultValue !== void 0) this.setOptionValueWithSource(name, option.defaultValue, "default");
		const handleOptionValue = (val, invalidValueMessage, valueSource) => {
			if (val == null && option.presetArg !== void 0) val = option.presetArg;
			const oldValue = this.getOptionValue(name);
			if (val !== null && option.parseArg) val = this._callParseArg(option, val, oldValue, invalidValueMessage);
			else if (val !== null && option.variadic) val = option._collectValue(val, oldValue);
			if (val == null) if (option.negate) val = false;
			else if (option.isBoolean() || option.optional) val = true;
			else val = "";
			this.setOptionValueWithSource(name, val, valueSource);
		};
		this.on("option:" + oname, (val) => {
			const invalidValueMessage = `error: option '${option.flags}' argument '${val}' is invalid.`;
			handleOptionValue(val, invalidValueMessage, "cli");
		});
		if (option.envVar) this.on("optionEnv:" + oname, (val) => {
			const invalidValueMessage = `error: option '${option.flags}' value '${val}' from env '${option.envVar}' is invalid.`;
			handleOptionValue(val, invalidValueMessage, "env");
		});
		return this;
	}
	/**
	* Internal implementation shared by .option() and .requiredOption()
	*
	* @return {Command} `this` command for chaining
	* @private
	*/
	_optionEx(config, flags, description, fn, defaultValue) {
		if (typeof flags === "object" && flags instanceof Option) throw new Error("To add an Option object use addOption() instead of option() or requiredOption()");
		const option = this.createOption(flags, description);
		option.makeOptionMandatory(!!config.mandatory);
		if (typeof fn === "function") option.default(defaultValue).argParser(fn);
		else if (fn instanceof RegExp) {
			const regex = fn;
			fn = (val, def) => {
				const m = regex.exec(val);
				return m ? m[0] : def;
			};
			option.default(defaultValue).argParser(fn);
		} else option.default(fn);
		return this.addOption(option);
	}
	/**
	* Define option with `flags`, `description`, and optional argument parsing function or `defaultValue` or both.
	*
	* The `flags` string contains the short and/or long flags, separated by comma, a pipe or space. A required
	* option-argument is indicated by `<>` and an optional option-argument by `[]`.
	*
	* See the README for more details, and see also addOption() and requiredOption().
	*
	* @example
	* program
	*     .option('-p, --pepper', 'add pepper')
	*     .option('--pt, --pizza-type <TYPE>', 'type of pizza') // required option-argument
	*     .option('-c, --cheese [CHEESE]', 'add extra cheese', 'mozzarella') // optional option-argument with default
	*     .option('-t, --tip <VALUE>', 'add tip to purchase cost', parseFloat) // custom parse function
	*
	* @param {string} flags
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom option processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	option(flags, description, parseArg, defaultValue) {
		return this._optionEx({}, flags, description, parseArg, defaultValue);
	}
	/**
	* Add a required option which must have a value after parsing. This usually means
	* the option must be specified on the command line. (Otherwise the same as .option().)
	*
	* The `flags` string contains the short and/or long flags, separated by comma, a pipe or space.
	*
	* @param {string} flags
	* @param {string} [description]
	* @param {(Function|*)} [parseArg] - custom option processing function or default value
	* @param {*} [defaultValue]
	* @return {Command} `this` command for chaining
	*/
	requiredOption(flags, description, parseArg, defaultValue) {
		return this._optionEx({ mandatory: true }, flags, description, parseArg, defaultValue);
	}
	/**
	* Alter parsing of short flags with optional values.
	*
	* @example
	* // for `.option('-f,--flag [value]'):
	* program.combineFlagAndOptionalValue(true);  // `-f80` is treated like `--flag=80`, this is the default behaviour
	* program.combineFlagAndOptionalValue(false) // `-fb` is treated like `-f -b`
	*
	* @param {boolean} [combine] - if `true` or omitted, an optional value can be specified directly after the flag.
	* @return {Command} `this` command for chaining
	*/
	combineFlagAndOptionalValue(combine = true) {
		this._combineFlagAndOptionalValue = !!combine;
		return this;
	}
	/**
	* Allow unknown options on the command line.
	*
	* @param {boolean} [allowUnknown] - if `true` or omitted, no error will be thrown for unknown options.
	* @return {Command} `this` command for chaining
	*/
	allowUnknownOption(allowUnknown = true) {
		this._allowUnknownOption = !!allowUnknown;
		return this;
	}
	/**
	* Allow excess command-arguments on the command line. Pass false to make excess arguments an error.
	*
	* @param {boolean} [allowExcess] - if `true` or omitted, no error will be thrown for excess arguments.
	* @return {Command} `this` command for chaining
	*/
	allowExcessArguments(allowExcess = true) {
		this._allowExcessArguments = !!allowExcess;
		return this;
	}
	/**
	* Enable positional options. Positional means global options are specified before subcommands which lets
	* subcommands reuse the same option names, and also enables subcommands to turn on passThroughOptions.
	* The default behaviour is non-positional and global options may appear anywhere on the command line.
	*
	* @param {boolean} [positional]
	* @return {Command} `this` command for chaining
	*/
	enablePositionalOptions(positional = true) {
		this._enablePositionalOptions = !!positional;
		return this;
	}
	/**
	* Pass through options that come after command-arguments rather than treat them as command-options,
	* so actual command-options come before command-arguments. Turning this on for a subcommand requires
	* positional options to have been enabled on the program (parent commands).
	* The default behaviour is non-positional and options may appear before or after command-arguments.
	*
	* @param {boolean} [passThrough] for unknown options.
	* @return {Command} `this` command for chaining
	*/
	passThroughOptions(passThrough = true) {
		this._passThroughOptions = !!passThrough;
		this._checkForBrokenPassThrough();
		return this;
	}
	/**
	* @private
	*/
	_checkForBrokenPassThrough() {
		if (this.parent && this._passThroughOptions && !this.parent._enablePositionalOptions) throw new Error(`passThroughOptions cannot be used for '${this._name}' without turning on enablePositionalOptions for parent command(s)`);
	}
	/**
	* Whether to store option values as properties on command object,
	* or store separately (specify false). In both cases the option values can be accessed using .opts().
	*
	* @param {boolean} [storeAsProperties=true]
	* @return {Command} `this` command for chaining
	*/
	storeOptionsAsProperties(storeAsProperties = true) {
		if (this.options.length) throw new Error("call .storeOptionsAsProperties() before adding options");
		if (Object.keys(this._optionValues).length) throw new Error("call .storeOptionsAsProperties() before setting option values");
		this._storeOptionsAsProperties = !!storeAsProperties;
		return this;
	}
	/**
	* Retrieve option value.
	*
	* @param {string} key
	* @return {object} value
	*/
	getOptionValue(key) {
		if (this._storeOptionsAsProperties) return this[key];
		return this._optionValues[key];
	}
	/**
	* Store option value.
	*
	* @param {string} key
	* @param {object} value
	* @return {Command} `this` command for chaining
	*/
	setOptionValue(key, value) {
		return this.setOptionValueWithSource(key, value, void 0);
	}
	/**
	* Store option value and where the value came from.
	*
	* @param {string} key
	* @param {object} value
	* @param {string} source - expected values are default/config/env/cli/implied
	* @return {Command} `this` command for chaining
	*/
	setOptionValueWithSource(key, value, source) {
		if (this._storeOptionsAsProperties) this[key] = value;
		else this._optionValues[key] = value;
		this._optionValueSources[key] = source;
		return this;
	}
	/**
	* Get source of option value.
	* Expected values are default | config | env | cli | implied
	*
	* @param {string} key
	* @return {string}
	*/
	getOptionValueSource(key) {
		return this._optionValueSources[key];
	}
	/**
	* Get source of option value. See also .optsWithGlobals().
	* Expected values are default | config | env | cli | implied
	*
	* @param {string} key
	* @return {string}
	*/
	getOptionValueSourceWithGlobals(key) {
		let source;
		this._getCommandAndAncestors().forEach((cmd) => {
			if (cmd.getOptionValueSource(key) !== void 0) source = cmd.getOptionValueSource(key);
		});
		return source;
	}
	/**
	* Get user arguments from implied or explicit arguments.
	* Side-effects: set _scriptPath if args included script. Used for default program name, and subcommand searches.
	*
	* @private
	*/
	_prepareUserArgs(argv, parseOptions) {
		if (argv !== void 0 && !Array.isArray(argv)) throw new Error("first parameter to parse must be array or undefined");
		parseOptions = parseOptions || {};
		if (argv === void 0 && parseOptions.from === void 0) {
			if (process$1.versions?.electron) parseOptions.from = "electron";
			const execArgv = process$1.execArgv ?? [];
			if (execArgv.includes("-e") || execArgv.includes("--eval") || execArgv.includes("-p") || execArgv.includes("--print")) parseOptions.from = "eval";
		}
		if (argv === void 0) argv = process$1.argv;
		this.rawArgs = argv.slice();
		let userArgs;
		switch (parseOptions.from) {
			case void 0:
			case "node":
				this._scriptPath = argv[1];
				userArgs = argv.slice(2);
				break;
			case "electron":
				if (process$1.defaultApp) {
					this._scriptPath = argv[1];
					userArgs = argv.slice(2);
				} else userArgs = argv.slice(1);
				break;
			case "user":
				userArgs = argv.slice(0);
				break;
			case "eval":
				userArgs = argv.slice(1);
				break;
			default: throw new Error(`unexpected parse option { from: '${parseOptions.from}' }`);
		}
		if (!this._name && this._scriptPath) this.nameFromFilename(this._scriptPath);
		this._name = this._name || "program";
		return userArgs;
	}
	/**
	* Parse `argv`, setting options and invoking commands when defined.
	*
	* Use parseAsync instead of parse if any of your action handlers are async.
	*
	* Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
	*
	* Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
	* - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
	* - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
	* - `'user'`: just user arguments
	*
	* @example
	* program.parse(); // parse process.argv and auto-detect electron and special node flags
	* program.parse(process.argv); // assume argv[0] is app and argv[1] is script
	* program.parse(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
	*
	* @param {string[]} [argv] - optional, defaults to process.argv
	* @param {object} [parseOptions] - optionally specify style of options with from: node/user/electron
	* @param {string} [parseOptions.from] - where the args are from: 'node', 'user', 'electron'
	* @return {Command} `this` command for chaining
	*/
	parse(argv, parseOptions) {
		this._prepareForParse();
		const userArgs = this._prepareUserArgs(argv, parseOptions);
		this._parseCommand([], userArgs);
		return this;
	}
	/**
	* Parse `argv`, setting options and invoking commands when defined.
	*
	* Call with no parameters to parse `process.argv`. Detects Electron and special node options like `node --eval`. Easy mode!
	*
	* Or call with an array of strings to parse, and optionally where the user arguments start by specifying where the arguments are `from`:
	* - `'node'`: default, `argv[0]` is the application and `argv[1]` is the script being run, with user arguments after that
	* - `'electron'`: `argv[0]` is the application and `argv[1]` varies depending on whether the electron application is packaged
	* - `'user'`: just user arguments
	*
	* @example
	* await program.parseAsync(); // parse process.argv and auto-detect electron and special node flags
	* await program.parseAsync(process.argv); // assume argv[0] is app and argv[1] is script
	* await program.parseAsync(my-args, { from: 'user' }); // just user supplied arguments, nothing special about argv[0]
	*
	* @param {string[]} [argv]
	* @param {object} [parseOptions]
	* @param {string} parseOptions.from - where the args are from: 'node', 'user', 'electron'
	* @return {Promise}
	*/
	async parseAsync(argv, parseOptions) {
		this._prepareForParse();
		const userArgs = this._prepareUserArgs(argv, parseOptions);
		await this._parseCommand([], userArgs);
		return this;
	}
	_prepareForParse() {
		if (this._savedState === null) {
			this.options.filter((option) => option.negate && option.defaultValue === void 0 && this.getOptionValue(option.attributeName()) === void 0).forEach((option) => {
				const positiveLongFlag = option.long.replace(/^--no-/, "--");
				if (!this._findOption(positiveLongFlag)) this.setOptionValueWithSource(option.attributeName(), true, "default");
			});
			this.saveStateBeforeParse();
		} else this.restoreStateBeforeParse();
	}
	/**
	* Called the first time parse is called to save state and allow a restore before subsequent calls to parse.
	* Not usually called directly, but available for subclasses to save their custom state.
	*
	* This is called in a lazy way. Only commands used in parsing chain will have state saved.
	*/
	saveStateBeforeParse() {
		this._savedState = {
			_name: this._name,
			_optionValues: { ...this._optionValues },
			_optionValueSources: { ...this._optionValueSources }
		};
	}
	/**
	* Restore state before parse for calls after the first.
	* Not usually called directly, but available for subclasses to save their custom state.
	*
	* This is called in a lazy way. Only commands used in parsing chain will have state restored.
	*/
	restoreStateBeforeParse() {
		if (this._storeOptionsAsProperties) throw new Error(`Can not call parse again when storeOptionsAsProperties is true.
- either make a new Command for each call to parse, or stop storing options as properties`);
		this._name = this._savedState._name;
		this._scriptPath = null;
		this.rawArgs = [];
		this._optionValues = { ...this._savedState._optionValues };
		this._optionValueSources = { ...this._savedState._optionValueSources };
		this.args = [];
		this.processedArgs = [];
	}
	/**
	* Throw if expected executable is missing. Add lots of help for author.
	*
	* @param {string} executableFile
	* @param {string} executableDir
	* @param {string} subcommandName
	*/
	_checkForMissingExecutable(executableFile, executableDir, subcommandName) {
		if (fs.existsSync(executableFile)) return;
		const executableMissing = `'${executableFile}' does not exist
 - if '${subcommandName}' is not meant to be an executable command, remove description parameter from '.command()' and use '.description()' instead
 - if the default executable name is not suitable, use the executableFile option to supply a custom name or path
 - ${executableDir ? `searched for local subcommand relative to directory '${executableDir}'` : "no directory for search for local subcommand, use .executableDir() to supply a custom directory"}`;
		throw new Error(executableMissing);
	}
	/**
	* Execute a sub-command executable.
	*
	* @private
	*/
	_executeSubCommand(subcommand, args) {
		args = args.slice();
		const sourceExt = [
			".js",
			".ts",
			".tsx",
			".mjs",
			".cjs"
		];
		function findFile(baseDir, baseName) {
			const localBin = path.resolve(baseDir, baseName);
			if (fs.existsSync(localBin)) return localBin;
			if (sourceExt.includes(path.extname(baseName))) return void 0;
			const foundExt = sourceExt.find((ext) => fs.existsSync(`${localBin}${ext}`));
			if (foundExt) return `${localBin}${foundExt}`;
		}
		this._checkForMissingMandatoryOptions();
		this._checkForConflictingOptions();
		let executableFile = subcommand._executableFile || `${this._name}-${subcommand._name}`;
		let executableDir = this._executableDir || "";
		if (this._scriptPath) {
			let resolvedScriptPath;
			try {
				resolvedScriptPath = fs.realpathSync(this._scriptPath);
			} catch {
				resolvedScriptPath = this._scriptPath;
			}
			executableDir = path.resolve(path.dirname(resolvedScriptPath), executableDir);
		}
		if (executableDir) {
			let localFile = findFile(executableDir, executableFile);
			if (!localFile && !subcommand._executableFile && this._scriptPath) {
				const legacyName = path.basename(this._scriptPath, path.extname(this._scriptPath));
				if (legacyName !== this._name) localFile = findFile(executableDir, `${legacyName}-${subcommand._name}`);
			}
			executableFile = localFile || executableFile;
		}
		const launchWithNode = sourceExt.includes(path.extname(executableFile));
		let proc;
		if (process$1.platform !== "win32") if (launchWithNode) {
			args.unshift(executableFile);
			args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
			proc = childProcess.spawn(process$1.argv[0], args, { stdio: "inherit" });
		} else proc = childProcess.spawn(executableFile, args, { stdio: "inherit" });
		else {
			this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
			args.unshift(executableFile);
			args = incrementNodeInspectorPort(process$1.execArgv).concat(args);
			proc = childProcess.spawn(process$1.execPath, args, { stdio: "inherit" });
		}
		if (!proc.killed) [
			"SIGUSR1",
			"SIGUSR2",
			"SIGTERM",
			"SIGINT",
			"SIGHUP"
		].forEach((signal) => {
			process$1.on(signal, () => {
				if (proc.killed === false && proc.exitCode === null) proc.kill(signal);
			});
		});
		const exitCallback = this._exitCallback;
		proc.on("close", (code) => {
			code = code ?? 1;
			if (!exitCallback) process$1.exit(code);
			else exitCallback(new CommanderError(code, "commander.executeSubCommandAsync", "(close)"));
		});
		proc.on("error", (err) => {
			if (err.code === "ENOENT") this._checkForMissingExecutable(executableFile, executableDir, subcommand._name);
			else if (err.code === "EACCES") throw new Error(`'${executableFile}' not executable`);
			if (!exitCallback) process$1.exit(1);
			else {
				const wrappedError = new CommanderError(1, "commander.executeSubCommandAsync", "(error)");
				wrappedError.nestedError = err;
				exitCallback(wrappedError);
			}
		});
		this.runningCommand = proc;
	}
	/**
	* @private
	*/
	_dispatchSubcommand(commandName, operands, unknown) {
		const subCommand = this._findCommand(commandName);
		if (!subCommand) this.help({ error: true });
		subCommand._prepareForParse();
		let promiseChain;
		promiseChain = this._chainOrCallSubCommandHook(promiseChain, subCommand, "preSubcommand");
		promiseChain = this._chainOrCall(promiseChain, () => {
			if (subCommand._executableHandler) this._executeSubCommand(subCommand, operands.concat(unknown));
			else return subCommand._parseCommand(operands, unknown);
		});
		return promiseChain;
	}
	/**
	* Invoke help directly if possible, or dispatch if necessary.
	* e.g. help foo
	*
	* @private
	*/
	_dispatchHelpCommand(subcommandName) {
		if (!subcommandName) this.help();
		const subCommand = this._findCommand(subcommandName);
		if (subCommand && !subCommand._executableHandler) subCommand.help();
		return this._dispatchSubcommand(subcommandName, [], [this._getHelpOption()?.long ?? this._getHelpOption()?.short ?? "--help"]);
	}
	/**
	* Check this.args against expected this.registeredArguments.
	*
	* @private
	*/
	_checkNumberOfArguments() {
		this.registeredArguments.forEach((arg, i) => {
			if (arg.required && this.args[i] == null) this.missingArgument(arg.name());
		});
		if (this.registeredArguments.length > 0 && this.registeredArguments[this.registeredArguments.length - 1].variadic) return;
		if (this.args.length > this.registeredArguments.length) this._excessArguments(this.args);
	}
	/**
	* Process this.args using this.registeredArguments and save as this.processedArgs!
	*
	* @private
	*/
	_processArguments() {
		const myParseArg = (argument, value, previous) => {
			let parsedValue = value;
			if (value !== null && argument.parseArg) {
				const invalidValueMessage = `error: command-argument value '${value}' is invalid for argument '${argument.name()}'.`;
				parsedValue = this._callParseArg(argument, value, previous, invalidValueMessage);
			}
			return parsedValue;
		};
		this._checkNumberOfArguments();
		const processedArgs = [];
		this.registeredArguments.forEach((declaredArg, index) => {
			let value = declaredArg.defaultValue;
			if (declaredArg.variadic) {
				if (index < this.args.length) {
					value = this.args.slice(index);
					if (declaredArg.parseArg) value = value.reduce((processed, v) => {
						return myParseArg(declaredArg, v, processed);
					}, declaredArg.defaultValue);
				} else if (value === void 0) value = [];
			} else if (index < this.args.length) {
				value = this.args[index];
				if (declaredArg.parseArg) value = myParseArg(declaredArg, value, declaredArg.defaultValue);
			}
			processedArgs[index] = value;
		});
		this.processedArgs = processedArgs;
	}
	/**
	* Once we have a promise we chain, but call synchronously until then.
	*
	* @param {(Promise|undefined)} promise
	* @param {Function} fn
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCall(promise, fn) {
		if (promise?.then && typeof promise.then === "function") return promise.then(() => fn());
		return fn();
	}
	/**
	*
	* @param {(Promise|undefined)} promise
	* @param {string} event
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCallHooks(promise, event) {
		let result = promise;
		const hooks = [];
		this._getCommandAndAncestors().reverse().filter((cmd) => cmd._lifeCycleHooks[event] !== void 0).forEach((hookedCommand) => {
			hookedCommand._lifeCycleHooks[event].forEach((callback) => {
				hooks.push({
					hookedCommand,
					callback
				});
			});
		});
		if (event === "postAction") hooks.reverse();
		hooks.forEach((hookDetail) => {
			result = this._chainOrCall(result, () => {
				return hookDetail.callback(hookDetail.hookedCommand, this);
			});
		});
		return result;
	}
	/**
	*
	* @param {(Promise|undefined)} promise
	* @param {Command} subCommand
	* @param {string} event
	* @return {(Promise|undefined)}
	* @private
	*/
	_chainOrCallSubCommandHook(promise, subCommand, event) {
		let result = promise;
		if (this._lifeCycleHooks[event] !== void 0) this._lifeCycleHooks[event].forEach((hook) => {
			result = this._chainOrCall(result, () => {
				return hook(this, subCommand);
			});
		});
		return result;
	}
	/**
	* Process arguments in context of this command.
	* Returns action result, in case it is a promise.
	*
	* @private
	*/
	_parseCommand(operands, unknown) {
		const parsed = this.parseOptions(unknown);
		this._parseOptionsEnv();
		this._parseOptionsImplied();
		operands = operands.concat(parsed.operands);
		unknown = parsed.unknown;
		this.args = operands.concat(unknown);
		if (operands && this._findCommand(operands[0])) return this._dispatchSubcommand(operands[0], operands.slice(1), unknown);
		if (this._getHelpCommand() && operands[0] === this._getHelpCommand().name()) return this._dispatchHelpCommand(operands[1]);
		if (this._defaultCommandName) {
			this._outputHelpIfRequested(unknown);
			return this._dispatchSubcommand(this._defaultCommandName, operands, unknown);
		}
		if (this.commands.length && this.args.length === 0 && !this._actionHandler && !this._defaultCommandName) this.help({ error: true });
		this._outputHelpIfRequested(parsed.unknown);
		this._checkForMissingMandatoryOptions();
		this._checkForConflictingOptions();
		const checkForUnknownOptions = () => {
			if (parsed.unknown.length > 0) this.unknownOption(parsed.unknown[0]);
		};
		const commandEvent = `command:${this.name()}`;
		if (this._actionHandler) {
			checkForUnknownOptions();
			this._processArguments();
			let promiseChain;
			promiseChain = this._chainOrCallHooks(promiseChain, "preAction");
			promiseChain = this._chainOrCall(promiseChain, () => this._actionHandler(this.processedArgs));
			if (this.parent) promiseChain = this._chainOrCall(promiseChain, () => {
				this.parent.emit(commandEvent, operands, unknown);
			});
			promiseChain = this._chainOrCallHooks(promiseChain, "postAction");
			return promiseChain;
		}
		if (this.parent?.listenerCount(commandEvent)) {
			checkForUnknownOptions();
			this._processArguments();
			this.parent.emit(commandEvent, operands, unknown);
		} else if (operands.length) {
			if (this._findCommand("*")) return this._dispatchSubcommand("*", operands, unknown);
			if (this.listenerCount("command:*")) this.emit("command:*", operands, unknown);
			else if (this.commands.length) this.unknownCommand();
			else {
				checkForUnknownOptions();
				this._processArguments();
			}
		} else if (this.commands.length) {
			checkForUnknownOptions();
			this.help({ error: true });
		} else {
			checkForUnknownOptions();
			this._processArguments();
		}
	}
	/**
	* Find matching command.
	*
	* @private
	* @return {Command | undefined}
	*/
	_findCommand(name) {
		if (!name) return void 0;
		return this.commands.find((cmd) => cmd._name === name || cmd._aliases.includes(name));
	}
	/**
	* Return an option matching `arg` if any.
	*
	* @param {string} arg
	* @return {Option}
	* @package
	*/
	_findOption(arg) {
		return this.options.find((option) => option.is(arg));
	}
	/**
	* Display an error message if a mandatory option does not have a value.
	* Called after checking for help flags in leaf subcommand.
	*
	* @private
	*/
	_checkForMissingMandatoryOptions() {
		this._getCommandAndAncestors().forEach((cmd) => {
			cmd.options.forEach((anOption) => {
				if (anOption.mandatory && cmd.getOptionValue(anOption.attributeName()) === void 0) cmd.missingMandatoryOptionValue(anOption);
			});
		});
	}
	/**
	* Display an error message if conflicting options are used together in this.
	*
	* @private
	*/
	_checkForConflictingLocalOptions() {
		const definedNonDefaultOptions = this.options.filter((option) => {
			const optionKey = option.attributeName();
			if (this.getOptionValue(optionKey) === void 0) return false;
			return this.getOptionValueSource(optionKey) !== "default";
		});
		definedNonDefaultOptions.filter((option) => option.conflictsWith.length > 0).forEach((option) => {
			const conflictingAndDefined = definedNonDefaultOptions.find((defined) => option.conflictsWith.includes(defined.attributeName()));
			if (conflictingAndDefined) this._conflictingOption(option, conflictingAndDefined);
		});
	}
	/**
	* Display an error message if conflicting options are used together.
	* Called after checking for help flags in leaf subcommand.
	*
	* @private
	*/
	_checkForConflictingOptions() {
		this._getCommandAndAncestors().forEach((cmd) => {
			cmd._checkForConflictingLocalOptions();
		});
	}
	/**
	* Parse options from `argv` removing known options,
	* and return argv split into operands and unknown arguments.
	*
	* Side effects: modifies command by storing options. Does not reset state if called again.
	*
	* Examples:
	*
	*     argv => operands, unknown
	*     --known kkk op => [op], []
	*     op --known kkk => [op], []
	*     sub --unknown uuu op => [sub], [--unknown uuu op]
	*     sub -- --unknown uuu op => [sub --unknown uuu op], []
	*
	* @param {string[]} args
	* @return {{operands: string[], unknown: string[]}}
	*/
	parseOptions(args) {
		const operands = [];
		const unknown = [];
		let dest = operands;
		function maybeOption(arg) {
			return arg.length > 1 && arg[0] === "-";
		}
		const negativeNumberArg = (arg) => {
			if (!/^-(\d+|\d*\.\d+)(e[+-]?\d+)?$/.test(arg)) return false;
			return !this._getCommandAndAncestors().some((cmd) => cmd.options.map((opt) => opt.short).some((short) => /^-\d$/.test(short)));
		};
		let activeVariadicOption = null;
		let activeGroup = null;
		let i = 0;
		while (i < args.length || activeGroup) {
			const arg = activeGroup ?? args[i++];
			activeGroup = null;
			if (arg === "--") {
				if (dest === unknown) dest.push(arg);
				dest.push(...args.slice(i));
				break;
			}
			if (activeVariadicOption && (!maybeOption(arg) || negativeNumberArg(arg))) {
				this.emit(`option:${activeVariadicOption.name()}`, arg);
				continue;
			}
			activeVariadicOption = null;
			if (maybeOption(arg)) {
				const option = this._findOption(arg);
				if (option) {
					if (option.required) {
						const value = args[i++];
						if (value === void 0) this.optionMissingArgument(option);
						this.emit(`option:${option.name()}`, value);
					} else if (option.optional) {
						let value = null;
						if (i < args.length && (!maybeOption(args[i]) || negativeNumberArg(args[i]))) value = args[i++];
						this.emit(`option:${option.name()}`, value);
					} else this.emit(`option:${option.name()}`);
					activeVariadicOption = option.variadic ? option : null;
					continue;
				}
			}
			if (arg.length > 2 && arg[0] === "-" && arg[1] !== "-") {
				const option = this._findOption(`-${arg[1]}`);
				if (option) {
					if (option.required || option.optional && this._combineFlagAndOptionalValue) this.emit(`option:${option.name()}`, arg.slice(2));
					else {
						this.emit(`option:${option.name()}`);
						activeGroup = `-${arg.slice(2)}`;
					}
					continue;
				}
			}
			if (/^--[^=]+=/.test(arg)) {
				const index = arg.indexOf("=");
				const option = this._findOption(arg.slice(0, index));
				if (option && (option.required || option.optional)) {
					this.emit(`option:${option.name()}`, arg.slice(index + 1));
					continue;
				}
			}
			if (dest === operands && maybeOption(arg) && !(this.commands.length === 0 && negativeNumberArg(arg))) dest = unknown;
			if ((this._enablePositionalOptions || this._passThroughOptions) && operands.length === 0 && unknown.length === 0) {
				if (this._findCommand(arg)) {
					operands.push(arg);
					unknown.push(...args.slice(i));
					break;
				} else if (this._getHelpCommand() && arg === this._getHelpCommand().name()) {
					operands.push(arg, ...args.slice(i));
					break;
				} else if (this._defaultCommandName) {
					unknown.push(arg, ...args.slice(i));
					break;
				}
			}
			if (this._passThroughOptions) {
				dest.push(arg, ...args.slice(i));
				break;
			}
			dest.push(arg);
		}
		return {
			operands,
			unknown
		};
	}
	/**
	* Return an object containing local option values as key-value pairs.
	*
	* @return {object}
	*/
	opts() {
		if (this._storeOptionsAsProperties) {
			const result = {};
			const len = this.options.length;
			for (let i = 0; i < len; i++) {
				const key = this.options[i].attributeName();
				result[key] = key === this._versionOptionName ? this._version : this[key];
			}
			return result;
		}
		return this._optionValues;
	}
	/**
	* Return an object containing merged local and global option values as key-value pairs.
	*
	* @return {object}
	*/
	optsWithGlobals() {
		return this._getCommandAndAncestors().reduce((combinedOptions, cmd) => Object.assign(combinedOptions, cmd.opts()), {});
	}
	/**
	* Display error message and exit (or call exitOverride).
	*
	* @param {string} message
	* @param {object} [errorOptions]
	* @param {string} [errorOptions.code] - an id string representing the error
	* @param {number} [errorOptions.exitCode] - used with process.exit
	*/
	error(message, errorOptions) {
		this._outputConfiguration.outputError(`${message}\n`, this._outputConfiguration.writeErr);
		if (typeof this._showHelpAfterError === "string") this._outputConfiguration.writeErr(`${this._showHelpAfterError}\n`);
		else if (this._showHelpAfterError) {
			this._outputConfiguration.writeErr("\n");
			this.outputHelp({ error: true });
		}
		const config = errorOptions || {};
		const exitCode = config.exitCode || 1;
		const code = config.code || "commander.error";
		this._exit(exitCode, code, message);
	}
	/**
	* Apply any option related environment variables, if option does
	* not have a value from cli or client code.
	*
	* @private
	*/
	_parseOptionsEnv() {
		this.options.forEach((option) => {
			if (option.envVar && option.envVar in process$1.env) {
				const optionKey = option.attributeName();
				if (this.getOptionValue(optionKey) === void 0 || [
					"default",
					"config",
					"env"
				].includes(this.getOptionValueSource(optionKey))) if (option.required || option.optional) this.emit(`optionEnv:${option.name()}`, process$1.env[option.envVar]);
				else this.emit(`optionEnv:${option.name()}`);
			}
		});
	}
	/**
	* Apply any implied option values, if option is undefined or default value.
	*
	* @private
	*/
	_parseOptionsImplied() {
		const dualHelper = new DualOptions(this.options);
		const hasCustomOptionValue = (optionKey) => {
			return this.getOptionValue(optionKey) !== void 0 && !["default", "implied"].includes(this.getOptionValueSource(optionKey));
		};
		this.options.filter((option) => option.implied !== void 0 && hasCustomOptionValue(option.attributeName()) && dualHelper.valueFromOption(this.getOptionValue(option.attributeName()), option)).forEach((option) => {
			Object.keys(option.implied).filter((impliedKey) => !hasCustomOptionValue(impliedKey)).forEach((impliedKey) => {
				this.setOptionValueWithSource(impliedKey, option.implied[impliedKey], "implied");
			});
		});
	}
	/**
	* Argument `name` is missing.
	*
	* @param {string} name
	* @private
	*/
	missingArgument(name) {
		const message = `error: missing required argument '${name}'`;
		this.error(message, { code: "commander.missingArgument" });
	}
	/**
	* `Option` is missing an argument.
	*
	* @param {Option} option
	* @private
	*/
	optionMissingArgument(option) {
		const message = `error: option '${option.flags}' argument missing`;
		this.error(message, { code: "commander.optionMissingArgument" });
	}
	/**
	* `Option` does not have a value, and is a mandatory option.
	*
	* @param {Option} option
	* @private
	*/
	missingMandatoryOptionValue(option) {
		const message = `error: required option '${option.flags}' not specified`;
		this.error(message, { code: "commander.missingMandatoryOptionValue" });
	}
	/**
	* `Option` conflicts with another option.
	*
	* @param {Option} option
	* @param {Option} conflictingOption
	* @private
	*/
	_conflictingOption(option, conflictingOption) {
		const findBestOptionFromValue = (option) => {
			const optionKey = option.attributeName();
			const optionValue = this.getOptionValue(optionKey);
			const negativeOption = this.options.find((target) => target.negate && optionKey === target.attributeName());
			const positiveOption = this.options.find((target) => !target.negate && optionKey === target.attributeName());
			if (negativeOption && (negativeOption.presetArg === void 0 && optionValue === false || negativeOption.presetArg !== void 0 && optionValue === negativeOption.presetArg)) return negativeOption;
			return positiveOption || option;
		};
		const getErrorMessage = (option) => {
			const bestOption = findBestOptionFromValue(option);
			const optionKey = bestOption.attributeName();
			if (this.getOptionValueSource(optionKey) === "env") return `environment variable '${bestOption.envVar}'`;
			return `option '${bestOption.flags}'`;
		};
		const message = `error: ${getErrorMessage(option)} cannot be used with ${getErrorMessage(conflictingOption)}`;
		this.error(message, { code: "commander.conflictingOption" });
	}
	/**
	* Unknown option `flag`.
	*
	* @param {string} flag
	* @private
	*/
	unknownOption(flag) {
		if (this._allowUnknownOption) return;
		let suggestion = "";
		if (flag.startsWith("--") && this._showSuggestionAfterError) {
			let candidateFlags = [];
			let command = this;
			do {
				const moreFlags = command.createHelp().visibleOptions(command).filter((option) => option.long).map((option) => option.long);
				candidateFlags = candidateFlags.concat(moreFlags);
				command = command.parent;
			} while (command && !command._enablePositionalOptions);
			suggestion = suggestSimilar(flag, candidateFlags);
		}
		const message = `error: unknown option '${flag}'${suggestion}`;
		this.error(message, { code: "commander.unknownOption" });
	}
	/**
	* Excess arguments, more than expected.
	*
	* @param {string[]} receivedArgs
	* @private
	*/
	_excessArguments(receivedArgs) {
		if (this._allowExcessArguments) return;
		const expected = this.registeredArguments.length;
		const s = expected === 1 ? "" : "s";
		const received = receivedArgs.length;
		const message = `error: too many arguments${this.parent ? ` for '${this.name()}'` : ""}. Expected ${expected} argument${s} but got ${received}: ${receivedArgs.join(", ")}.`;
		this.error(message, { code: "commander.excessArguments" });
	}
	/**
	* Unknown command.
	*
	* @private
	*/
	unknownCommand() {
		const unknownName = this.args[0];
		let suggestion = "";
		if (this._showSuggestionAfterError) {
			const candidateNames = [];
			this.createHelp().visibleCommands(this).forEach((command) => {
				candidateNames.push(command.name());
				if (command.alias()) candidateNames.push(command.alias());
			});
			suggestion = suggestSimilar(unknownName, candidateNames);
		}
		const message = `error: unknown command '${unknownName}'${suggestion}`;
		this.error(message, { code: "commander.unknownCommand" });
	}
	/**
	* Get or set the program version.
	*
	* This method auto-registers the "-V, --version" option which will print the version number.
	*
	* You can optionally supply the flags and description to override the defaults.
	*
	* @param {string} [str]
	* @param {string} [flags]
	* @param {string} [description]
	* @return {(this | string | undefined)} `this` command for chaining, or version string if no arguments
	*/
	version(str, flags, description) {
		if (str === void 0) return this._version;
		this._version = str;
		flags = flags || "-V, --version";
		description = description || "output the version number";
		const versionOption = this.createOption(flags, description);
		this._versionOptionName = versionOption.attributeName();
		this._registerOption(versionOption);
		this.on("option:" + versionOption.name(), () => {
			this._outputConfiguration.writeOut(`${str}\n`);
			this._exit(0, "commander.version", str);
		});
		return this;
	}
	/**
	* Set the description.
	*
	* @param {string} [str]
	* @param {object} [argsDescription]
	* @return {(string|Command)}
	*/
	description(str, argsDescription) {
		if (str === void 0 && argsDescription === void 0) return this._description;
		this._description = str;
		if (argsDescription) this._argsDescription = argsDescription;
		return this;
	}
	/**
	* Set the summary. Used when listed as subcommand of parent.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	summary(str) {
		if (str === void 0) return this._summary;
		this._summary = str;
		return this;
	}
	/**
	* Set an alias for the command.
	*
	* You may call more than once to add multiple aliases. Only the first alias is shown in the auto-generated help.
	*
	* @param {string} [alias]
	* @return {(string|Command)}
	*/
	alias(alias) {
		if (alias === void 0) return this._aliases[0];
		/** @type {Command} */
		let command = this;
		if (this.commands.length !== 0 && this.commands[this.commands.length - 1]._executableHandler) command = this.commands[this.commands.length - 1];
		if (alias === command._name) throw new Error("Command alias can't be the same as its name");
		const matchingCommand = this.parent?._findCommand(alias);
		if (matchingCommand) {
			const existingCmd = [matchingCommand.name()].concat(matchingCommand.aliases()).join("|");
			throw new Error(`cannot add alias '${alias}' to command '${this.name()}' as already have command '${existingCmd}'`);
		}
		command._aliases.push(alias);
		return this;
	}
	/**
	* Set aliases for the command.
	*
	* Only the first alias is shown in the auto-generated help.
	*
	* @param {string[]} [aliases]
	* @return {(string[]|Command)}
	*/
	aliases(aliases) {
		if (aliases === void 0) return this._aliases;
		aliases.forEach((alias) => this.alias(alias));
		return this;
	}
	/**
	* Set / get the command usage `str`.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	usage(str) {
		if (str === void 0) {
			if (this._usage) return this._usage;
			const args = this.registeredArguments.map((arg) => {
				return humanReadableArgName(arg);
			});
			return [].concat(this.options.length || this._helpOption !== null ? "[options]" : [], this.commands.length ? "[command]" : [], this.registeredArguments.length ? args : []).join(" ");
		}
		this._usage = str;
		return this;
	}
	/**
	* Get or set the name of the command.
	*
	* @param {string} [str]
	* @return {(string|Command)}
	*/
	name(str) {
		if (str === void 0) return this._name;
		this._name = str;
		return this;
	}
	/**
	* Set/get the help group heading for this subcommand in parent command's help.
	*
	* @param {string} [heading]
	* @return {Command | string}
	*/
	helpGroup(heading) {
		if (heading === void 0) return this._helpGroupHeading ?? "";
		this._helpGroupHeading = heading;
		return this;
	}
	/**
	* Set/get the default help group heading for subcommands added to this command.
	* (This does not override a group set directly on the subcommand using .helpGroup().)
	*
	* @example
	* program.commandsGroup('Development Commands:);
	* program.command('watch')...
	* program.command('lint')...
	* ...
	*
	* @param {string} [heading]
	* @returns {Command | string}
	*/
	commandsGroup(heading) {
		if (heading === void 0) return this._defaultCommandGroup ?? "";
		this._defaultCommandGroup = heading;
		return this;
	}
	/**
	* Set/get the default help group heading for options added to this command.
	* (This does not override a group set directly on the option using .helpGroup().)
	*
	* @example
	* program
	*   .optionsGroup('Development Options:')
	*   .option('-d, --debug', 'output extra debugging')
	*   .option('-p, --profile', 'output profiling information')
	*
	* @param {string} [heading]
	* @returns {Command | string}
	*/
	optionsGroup(heading) {
		if (heading === void 0) return this._defaultOptionGroup ?? "";
		this._defaultOptionGroup = heading;
		return this;
	}
	/**
	* @param {Option} option
	* @private
	*/
	_initOptionGroup(option) {
		if (this._defaultOptionGroup && !option.helpGroupHeading) option.helpGroup(this._defaultOptionGroup);
	}
	/**
	* @param {Command} cmd
	* @private
	*/
	_initCommandGroup(cmd) {
		if (this._defaultCommandGroup && !cmd.helpGroup()) cmd.helpGroup(this._defaultCommandGroup);
	}
	/**
	* Set the name of the command from script filename, such as process.argv[1],
	* or import.meta.filename.
	*
	* (Used internally and public although not documented in README.)
	*
	* @example
	* program.nameFromFilename(import.meta.filename);
	*
	* @param {string} filename
	* @return {Command}
	*/
	nameFromFilename(filename) {
		this._name = path.basename(filename, path.extname(filename));
		return this;
	}
	/**
	* Get or set the directory for searching for executable subcommands of this command.
	*
	* @example
	* program.executableDir(import.meta.dirname);
	* // or
	* program.executableDir('subcommands');
	*
	* @param {string} [path]
	* @return {(string|null|Command)}
	*/
	executableDir(path) {
		if (path === void 0) return this._executableDir;
		this._executableDir = path;
		return this;
	}
	/**
	* Return program help documentation.
	*
	* @param {{ error: boolean }} [contextOptions] - pass {error:true} to wrap for stderr instead of stdout
	* @return {string}
	*/
	helpInformation(contextOptions) {
		const helper = this.createHelp();
		const context = this._getOutputContext(contextOptions);
		helper.prepareContext({
			error: context.error,
			helpWidth: context.helpWidth,
			outputHasColors: context.hasColors
		});
		const text = helper.formatHelp(this, helper);
		if (context.hasColors) return text;
		return this._outputConfiguration.stripColor(text);
	}
	/**
	* @typedef HelpContext
	* @type {object}
	* @property {boolean} error
	* @property {number} helpWidth
	* @property {boolean} hasColors
	* @property {function} write - includes stripColor if needed
	*
	* @returns {HelpContext}
	* @private
	*/
	_getOutputContext(contextOptions) {
		contextOptions = contextOptions || {};
		const error = !!contextOptions.error;
		let baseWrite;
		let hasColors;
		let helpWidth;
		if (error) {
			baseWrite = (str) => this._outputConfiguration.writeErr(str);
			hasColors = this._outputConfiguration.getErrHasColors();
			helpWidth = this._outputConfiguration.getErrHelpWidth();
		} else {
			baseWrite = (str) => this._outputConfiguration.writeOut(str);
			hasColors = this._outputConfiguration.getOutHasColors();
			helpWidth = this._outputConfiguration.getOutHelpWidth();
		}
		const write = (str) => {
			if (!hasColors) str = this._outputConfiguration.stripColor(str);
			return baseWrite(str);
		};
		return {
			error,
			write,
			hasColors,
			helpWidth
		};
	}
	/**
	* Output help information for this command.
	*
	* Outputs built-in help, and custom text added using `.addHelpText()`.
	*
	* @param {{ error: boolean } | Function} [contextOptions] - pass {error:true} to write to stderr instead of stdout
	*/
	outputHelp(contextOptions) {
		let deprecatedCallback;
		if (typeof contextOptions === "function") {
			deprecatedCallback = contextOptions;
			contextOptions = void 0;
		}
		const outputContext = this._getOutputContext(contextOptions);
		/** @type {HelpTextEventContext} */
		const eventContext = {
			error: outputContext.error,
			write: outputContext.write,
			command: this
		};
		this._getCommandAndAncestors().reverse().forEach((command) => command.emit("beforeAllHelp", eventContext));
		this.emit("beforeHelp", eventContext);
		let helpInformation = this.helpInformation({ error: outputContext.error });
		if (deprecatedCallback) {
			helpInformation = deprecatedCallback(helpInformation);
			if (typeof helpInformation !== "string" && !Buffer.isBuffer(helpInformation)) throw new Error("outputHelp callback must return a string or a Buffer");
		}
		outputContext.write(helpInformation);
		if (this._getHelpOption()?.long) this.emit(this._getHelpOption().long);
		this.emit("afterHelp", eventContext);
		this._getCommandAndAncestors().forEach((command) => command.emit("afterAllHelp", eventContext));
	}
	/**
	* You can pass in flags and a description to customise the built-in help option.
	* Pass in false to disable the built-in help option.
	*
	* @example
	* program.helpOption('-?, --help' 'show help'); // customise
	* program.helpOption(false); // disable
	*
	* @param {(string | boolean)} flags
	* @param {string} [description]
	* @return {Command} `this` command for chaining
	*/
	helpOption(flags, description) {
		if (typeof flags === "boolean") {
			if (flags) {
				if (this._helpOption === null) this._helpOption = void 0;
				if (this._defaultOptionGroup) this._initOptionGroup(this._getHelpOption());
			} else this._helpOption = null;
			return this;
		}
		this._helpOption = this.createOption(flags ?? "-h, --help", description ?? "display help for command");
		if (flags || description) this._initOptionGroup(this._helpOption);
		return this;
	}
	/**
	* Lazy create help option.
	* Returns null if has been disabled with .helpOption(false).
	*
	* @returns {(Option | null)} the help option
	* @package
	*/
	_getHelpOption() {
		if (this._helpOption === void 0) this.helpOption(void 0, void 0);
		return this._helpOption;
	}
	/**
	* Supply your own option to use for the built-in help option.
	* This is an alternative to using helpOption() to customise the flags and description etc.
	*
	* @param {Option} option
	* @return {Command} `this` command for chaining
	*/
	addHelpOption(option) {
		this._helpOption = option;
		this._initOptionGroup(option);
		return this;
	}
	/**
	* Output help information and exit.
	*
	* Outputs built-in help, and custom text added using `.addHelpText()`.
	*
	* @param {{ error: boolean }} [contextOptions] - pass {error:true} to write to stderr instead of stdout
	*/
	help(contextOptions) {
		this.outputHelp(contextOptions);
		let exitCode = Number(process$1.exitCode ?? 0);
		if (exitCode === 0 && contextOptions && typeof contextOptions !== "function" && contextOptions.error) exitCode = 1;
		this._exit(exitCode, "commander.help", "(outputHelp)");
	}
	/**
	* // Do a little typing to coordinate emit and listener for the help text events.
	* @typedef HelpTextEventContext
	* @type {object}
	* @property {boolean} error
	* @property {Command} command
	* @property {function} write
	*/
	/**
	* Add additional text to be displayed with the built-in help.
	*
	* Position is 'before' or 'after' to affect just this command,
	* and 'beforeAll' or 'afterAll' to affect this command and all its subcommands.
	*
	* @param {string} position - before or after built-in help
	* @param {(string | Function)} text - string to add, or a function returning a string
	* @return {Command} `this` command for chaining
	*/
	addHelpText(position, text) {
		const allowedValues = [
			"beforeAll",
			"before",
			"after",
			"afterAll"
		];
		if (!allowedValues.includes(position)) throw new Error(`Unexpected value for position to addHelpText.
Expecting one of '${allowedValues.join("', '")}'`);
		const helpEvent = `${position}Help`;
		this.on(helpEvent, (context) => {
			let helpStr;
			if (typeof text === "function") helpStr = text({
				error: context.error,
				command: context.command
			});
			else helpStr = text;
			if (helpStr) context.write(`${helpStr}\n`);
		});
		return this;
	}
	/**
	* Output help information if help flags specified
	*
	* @param {Array} args - array of options to search for help flags
	* @private
	*/
	_outputHelpIfRequested(args) {
		const helpOption = this._getHelpOption();
		if (helpOption && args.find((arg) => helpOption.is(arg))) {
			this.outputHelp();
			this._exit(0, "commander.helpDisplayed", "(outputHelp)");
		}
	}
};
/**
* Scan arguments and increment port number for inspect calls (to avoid conflicts when spawning new command).
*
* @param {string[]} args - array of arguments from node.execArgv
* @returns {string[]}
* @private
*/
function incrementNodeInspectorPort(args) {
	return args.map((arg) => {
		if (!arg.startsWith("--inspect")) return arg;
		let debugOption;
		let debugHost = "127.0.0.1";
		let debugPort = "9229";
		let match;
		if ((match = arg.match(/^(--inspect(-brk)?)$/)) !== null) debugOption = match[1];
		else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+)$/)) !== null) {
			debugOption = match[1];
			if (/^\d+$/.test(match[3])) debugPort = match[3];
			else debugHost = match[3];
		} else if ((match = arg.match(/^(--inspect(-brk|-port)?)=([^:]+):(\d+)$/)) !== null) {
			debugOption = match[1];
			debugHost = match[3];
			debugPort = match[4];
		}
		if (debugOption && debugPort !== "0") return `${debugOption}=${debugHost}:${parseInt(debugPort) + 1}`;
		return arg;
	});
}
/**
* Exported for using from tests, not otherwise used outside this file.
*
* @returns {boolean | undefined}
* @package
*/
function useColor() {
	if (process$1.env.NO_COLOR || process$1.env.FORCE_COLOR === "0" || process$1.env.FORCE_COLOR === "false") return false;
	if (process$1.env.FORCE_COLOR || process$1.env.CLICOLOR_FORCE !== void 0) return true;
}

//#endregion
//#region ../../node_modules/.pnpm/commander@15.0.0/node_modules/commander/index.js
const program = new Command();

//#endregion
//#region src/output.ts
const NO_WARNINGS$5 = [];
const toLines = (human) => {
	if (Array.isArray(human)) return human;
	return [human];
};
const emit = (ctx, opts, human, data, warnings) => {
	if (opts.json) {
		const envelope = {
			data,
			ok: true,
			warnings: warnings ?? NO_WARNINGS$5
		};
		ctx.out(JSON.stringify(envelope));
		return;
	}
	for (const line of toLines(human)) ctx.out(line);
	for (const warning of warnings ?? NO_WARNINGS$5) ctx.errLine(`refs: warning: ${warning}`);
};
const emitError = (ctx, opts, rendered) => {
	if (opts.json) {
		const envelope = {
			error: {
				code: rendered.code,
				message: rendered.message
			},
			ok: false
		};
		ctx.out(JSON.stringify(envelope));
		return;
	}
	ctx.errLine(`refs: ${rendered.message}`);
};
const wrapAction = (ctx, opts, action) => async () => {
	try {
		await action();
	} catch (error) {
		const rendered = renderError(error, { verbose: opts.verbose });
		emitError(ctx, opts, rendered);
		process.exitCode = rendered.exitCode;
	}
};

//#endregion
//#region package.json
var version = "0.1.0";

//#endregion
//#region src/commands/doctor-checks-basic.ts
const SUCCESS_EXIT_CODE$3 = 0;
const checkGit = async (ctx) => {
	const result = await ctx.runner.run("git", ["--version"]);
	if (result.exitCode === SUCCESS_EXIT_CODE$3) return {
		detail: result.stdout.trim(),
		name: "git",
		status: "ok"
	};
	return {
		detail: result.stderr.trim() || `git --version exited with code ${result.exitCode}`,
		name: "git",
		status: "fail"
	};
};
const NODE_VERSION_PATTERN = /^v(?<major>\d+)\.(?<minor>\d+)/u;
const MIN_SUPPORTED_MAJOR = 24;
const MIN_SUPPORTED_MINOR = 12;
const parseNodeVersion = (version) => {
	const match = NODE_VERSION_PATTERN.exec(version);
	const majorText = match?.groups?.["major"];
	const minorText = match?.groups?.["minor"];
	if (majorText === void 0 || minorText === void 0) return;
	return {
		major: Number(majorText),
		minor: Number(minorText)
	};
};
const satisfiesSupportedRange = (parsed) => {
	if (parsed === void 0) return false;
	return parsed.major === MIN_SUPPORTED_MAJOR && parsed.minor >= MIN_SUPPORTED_MINOR;
};
const checkNode = (ctx) => {
	const { nodeVersion: version } = ctx;
	if (satisfiesSupportedRange(parseNodeVersion(version))) return {
		detail: version,
		name: "node",
		status: "ok"
	};
	return {
		detail: `${version} does not satisfy the required range >=24.12 <25`,
		name: "node",
		status: "fail"
	};
};
const errorMessageOf = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
const buildEmptyConfig = () => zConfig.parse({
	meta: {
		cli_version: "0.0.0",
		schema_version: 1
	},
	refs: {},
	settings: {}
});
/** Never throws: `readConfig` throws a typed `RefsError` for an absent config (`refs init` hint),
* an older/newer schema (`refs migrate` hint / `upgrade refs`), or a malformed shape — every one of
* those messages is already actionable, so it is carried through to the `config` check's `detail`
* verbatim rather than being re-worded here. */
const loadConfigSafely = async (home) => {
	try {
		return { config: await readConfig(home) };
	} catch (error) {
		return {
			config: buildEmptyConfig(),
			errorMessage: errorMessageOf(error)
		};
	}
};
const buildConfigCheck = (errorMessage) => {
	if (errorMessage === void 0) return {
		detail: "config is present and matches the current schema",
		name: "config",
		status: "ok"
	};
	return {
		detail: errorMessage,
		name: "config",
		status: "fail"
	};
};
const CLAUDE_SKILL_SEGMENTS = [
	".claude",
	"skills",
	"refs",
	"SKILL.md"
];
const CODEX_SKILL_SEGMENTS = [
	".codex",
	"skills",
	"refs",
	"SKILL.md"
];
const SKILL_INSTALL_HINT = "npx skills add kaisers-io/refs";
/** `home` is `ctx.env['HOME']`, never the real process env directly (per the task brief) — an
* unset `HOME` (e.g. a test's bare `testContext()`) yields no candidates at all, which reports as
* "not found" below rather than throwing on a `join()` with `undefined`. */
const skillCandidatePaths = (home) => {
	if (home === void 0) return [];
	return [join(home, ...CLAUDE_SKILL_SEGMENTS), join(home, ...CODEX_SKILL_SEGMENTS)];
};
const pathExists = async (path) => {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
};
const checkSkill = async (ctx) => {
	const candidates = skillCandidatePaths(ctx.env["HOME"]);
	if ((await Promise.all(candidates.map((path) => pathExists(path)))).some(Boolean)) return {
		detail: "the refs skill is installed",
		name: "skill",
		status: "ok"
	};
	return {
		detail: `refs skill not found — install it: ${SKILL_INSTALL_HINT}`,
		name: "skill",
		status: "warn"
	};
};

//#endregion
//#region src/commands/doctor-checks-checkouts.ts
const SUCCESS_EXIT_CODE$2 = 0;
const EMPTY_LENGTH$4 = 0;
/** Every configured ref whose checkout directory currently exists on disk — a ref with a missing
* checkout is out of scope for both checks below (`refs list`/`refs sync` already surface that
* state elsewhere; there is nothing to probe with `git` against a directory that isn't there). */
const existingCheckouts = (home, config) => Object.keys(config.refs).map((key) => ({
	dest: checkoutPath(home, zRefKey.parse(key)),
	key
})).filter((item) => isGitCheckout(item.dest));
const GUARD_HOOK_NAMES = ["pre-commit", "pre-push"];
const hookExecutable = async (home, name) => {
	try {
		await access(join(home.hooksDir, name), constants.X_OK);
		return true;
	} catch {
		return false;
	}
};
/** Every guard hook name that is missing or not executable — empty when both are present, naming
* whichever one(s) failed rather than collapsing to a single generic "hooks missing" message. */
const missingGuardHooks = async (home) => {
	const flags = await Promise.all(GUARD_HOOK_NAMES.map((name) => hookExecutable(home, name)));
	return GUARD_HOOK_NAMES.filter((_name, index) => !flags[index]);
};
/** Whether `dest`'s `core.hooksPath` points at THIS home's hooks directory — the same marker
* `cloneRepo`/`ensureManagedCheckout` (core) stamp/verify elsewhere, re-checked here per-checkout
* as `doctor`'s own read-only-guard integrity sweep. */
const checkoutHooksPathOk = async (ctx, home, dest) => {
	const result = await ctx.runner.run("git", [
		"config",
		"--local",
		"--get",
		"core.hooksPath"
	], { cwd: dest });
	return result.exitCode === SUCCESS_EXIT_CODE$2 && result.stdout.trim() === home.hooksDir;
};
const buildHooksGuardResult = (opts) => {
	if (opts.missingHooks.length > EMPTY_LENGTH$4) return {
		detail: `${opts.missingHooks.map((name) => `hooks/${name}`).join(", ")} missing or not executable — run: refs init`,
		name: "hooks-guard",
		status: "fail"
	};
	if (opts.badKeys.length > EMPTY_LENGTH$4) return {
		detail: `core.hooksPath not set for: ${opts.badKeys.join(", ")} — run: refs init`,
		name: "hooks-guard",
		status: "fail"
	};
	return {
		detail: `${GUARD_HOOK_NAMES.map((name) => `hooks/${name}`).join(", ")} present; ${opts.checkoutCount} checkout(s) guarded`,
		name: "hooks-guard",
		status: "ok"
	};
};
const checkHooksGuard = async (ctx, home, config) => {
	const checkouts = existingCheckouts(home, config);
	const [missingHooks, hooksPathFlags] = await Promise.all([missingGuardHooks(home), Promise.all(checkouts.map((item) => checkoutHooksPathOk(ctx, home, item.dest)))]);
	const badKeys = checkouts.filter((_item, index) => !hooksPathFlags[index]).map((item) => item.key);
	return buildHooksGuardResult({
		badKeys,
		checkoutCount: checkouts.length,
		missingHooks
	});
};
/** A non-zero exit from `git status --porcelain` (e.g. a stripped/corrupt `.git`, permissions
* denied on the working tree) means the checkout couldn't be inspected at all — that is a
* `broken` checkout, distinct from (and reported instead of) a merely `dirty` one: an empty
* `stdout` from a FAILED command is not the same fact as an empty `stdout` from a SUCCESSFUL one,
* and treating them alike would silently report a broken checkout as clean. */
const checkoutStatusFor = async (ctx, item) => {
	const result = await ctx.runner.run("git", ["status", "--porcelain"], { cwd: item.dest });
	if (result.exitCode !== SUCCESS_EXIT_CODE$2) return {
		broken: true,
		detail: result.stderr.trim(),
		dirty: false,
		key: item.key
	};
	return {
		broken: false,
		detail: "",
		dirty: result.stdout.trim() !== "",
		key: item.key
	};
};
const buildDirtyCheckoutsResult = (statuses) => {
	const broken = statuses.filter((status) => status.broken);
	if (broken.length > EMPTY_LENGTH$4) return {
		detail: broken.map((status) => `${status.key}: git status failed — ${status.detail}`).join("; "),
		name: "dirty-checkouts",
		status: "fail"
	};
	const dirtyKeys = statuses.filter((status) => status.dirty).map((status) => status.key);
	if (dirtyKeys.length === EMPTY_LENGTH$4) return {
		detail: "no local changes in any checkout",
		name: "dirty-checkouts",
		status: "ok"
	};
	return {
		detail: `local changes will be discarded on next sync: ${dirtyKeys.join(", ")}`,
		name: "dirty-checkouts",
		status: "warn"
	};
};
const checkDirtyCheckouts = async (ctx, home, config) => {
	const checkouts = existingCheckouts(home, config);
	const statuses = await Promise.all(checkouts.map((item) => checkoutStatusFor(ctx, item)));
	return buildDirtyCheckoutsResult(statuses);
};

//#endregion
//#region src/commands/doctor-checks-orphans.ts
const EMPTY_LENGTH$3 = 0;
/** Never throws: `readState` is already self-healing for a corrupt/malformed state file, but an
* unexpected fs fault (e.g. permission denied) still propagates from it — caught here too, since
* `doctor` must run every check regardless of what it finds. */
const loadStateSafely = async (home) => {
	try {
		return await readState(home);
	} catch {
		return zState.parse({});
	}
};
const listSubdirNames = async (dir) => {
	try {
		return (await readdir(dir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
	} catch (error) {
		if (isEnoent(error)) return [];
		throw error;
	}
};
/** Recursively walks `dir`, returning the segment path (relative to `sources/`) of every git
* checkout found. A directory containing `.git` ends that branch of the walk rather than being
* descended into further — a checkout's own internal folders are never mistaken for nested
* checkouts. Recursive (mirroring `remove.ts#pruneEmptyParents`'s "recursive rather than an
* imperative loop" discipline) so no single function's statement count grows with tree depth. */
const findCheckoutSegments = async (dir, segments) => {
	if (isGitCheckout(dir)) return [[...segments]];
	const names = await listSubdirNames(dir);
	return (await Promise.all(names.map((name) => findCheckoutSegments(join(dir, name), [...segments, name])))).flat();
};
const TWENTY_FOUR_HOURS_MS = 864e5;
const isFreshPendingProposal = (state, key, now) => {
	const pendingAt = state.refs[key]?.pending_proposal_at;
	if (pendingAt === void 0) return false;
	return now - Date.parse(pendingAt) < TWENTY_FOUR_HOURS_MS;
};
const classifyOrphan = (candidate, state, now) => {
	if (isFreshPendingProposal(state, candidate.key, now)) return `${candidate.key}: pending add`;
	return `${candidate.key}: orphan — remove with: rm -rf ${candidate.dest}`;
};
const toCandidate = (home, segments) => ({
	dest: join(home.sourcesDir, ...segments),
	key: segments.join("/")
});
const checkOrphans = async (home, config, state) => {
	const candidates = (await findCheckoutSegments(home.sourcesDir, [])).map((segments) => toCandidate(home, segments)).filter((candidate) => !Object.hasOwn(config.refs, candidate.key));
	if (candidates.length === EMPTY_LENGTH$3) return {
		detail: "no orphaned checkouts under sources/",
		name: "orphans",
		status: "ok"
	};
	const now = Date.now();
	return {
		detail: candidates.map((candidate) => classifyOrphan(candidate, state, now)).join("; "),
		name: "orphans",
		status: "warn"
	};
};

//#endregion
//#region src/commands/doctor-checks-ssh.ts
const EMPTY_LENGTH$2 = 0;
const SCP_HOST_PATTERN = /^(?<user>[^/\s@]+)@(?<host>[^:/\s]+):/u;
const SSH_PROTOCOL = "ssh:";
const DEFAULT_SSH_USER = "git";
const usernameOpt = (username) => {
	if (username === "") return {};
	return { user: username };
};
const portOpt = (port) => {
	if (port === "") return {};
	return { port };
};
/** The `ssh://[user@]host[:port]/path` form only — split out of `sshTargetFor` (below) purely to
* keep that function's own statement count under the repo's `max-statements` cap. `new URL(...)`
* throwing (a genuinely malformed url) reports the same `undefined` as "not an ssh url". An absent
* `url.username` leaves `user` unset (`undefined`) rather than defaulting to `git`: a real
* `ssh <host>`/clone with no explicit user lets the LOCAL ssh config decide who connects, and
* forcing `git@` here would probe a different principal than the one the actual clone uses. Only
* the scp form (below) and an explicit `ssh://user@` carry a user. */
const sshTargetFromUrl = (url) => {
	try {
		const parsed = new URL(url);
		if (parsed.protocol !== SSH_PROTOCOL) return;
		return {
			host: parsed.hostname,
			...usernameOpt(parsed.username),
			...portOpt(parsed.port)
		};
	} catch {
		return;
	}
};
/** Extracts the ssh user+host (and, for an explicit `ssh://` port, that port too) from `url`, or
* `undefined` when `url` isn't an ssh-transport git url. Checks the scp-style `user@host:path`
* shorthand FIRST (mirroring core's own `git-url.ts#SCP_URL`): `new URL(...)` throws on that form
* rather than parsing it, so it must be tried before falling back to `sshTargetFromUrl`. The scp
* form never carries a port of its own (`host:port` there would be ambiguous with the path
* separator — core's own `git-url.ts` rejects it outright). */
const sshTargetFor = (url) => {
	const scp = SCP_HOST_PATTERN.exec(url);
	const scpHost = scp?.groups?.["host"];
	if (scpHost !== void 0) return {
		host: scpHost,
		user: scp?.groups?.["user"] ?? DEFAULT_SSH_USER
	};
	return sshTargetFromUrl(url);
};
/** The label used both to dedupe targets and to display them in a check's `detail`, covering the
* FULL probe identity — `user@` whenever `target.user` is actually known (finding: host-only
* dedupe collapsed two same-host refs with different users into one probe, reporting one ref's
* auth from another ref's user; a second finding required a bare, userless `ssh://` target to
* stay visibly distinct from an explicit `git@host` one, since the two can probe different
* principals), `:port` only when an `ssh://` url actually carried a non-default one (finding: a
* dropped port silently probed 22). Hostnames can never contain `@` or `:` in the url forms core
* accepts, so distinct identities always yield distinct labels. */
const hostPartFor = (target) => {
	if (target.port === void 0) return target.host;
	return `${target.host}:${target.port}`;
};
const displayFor = (target) => {
	if (target.user === void 0) return hostPartFor(target);
	return `${target.user}@${hostPartFor(target)}`;
};
const uniqueSshTargets = (config) => {
	const targets = Object.values(config.refs).map((ref) => sshTargetFor(ref.url)).filter((target) => target !== void 0);
	const byDisplay = /* @__PURE__ */ new Map();
	for (const target of targets) byDisplay.set(displayFor(target), target);
	return [...byDisplay.values()].toSorted((left, right) => displayFor(left).localeCompare(displayFor(right)));
};
const SSH_CONNECT_TIMEOUT_SECONDS = 5;
const SSH_PROBE_TIMEOUT_MS = 1e4;
const MS_PER_SECOND = 1e3;
const PERMISSION_DENIED_PATTERN = /Permission denied/u;
const CONNECTION_WARN_PATTERNS = [
	/Could not resolve hostname/u,
	/Connection refused/u,
	/Host key verification failed/u,
	/timed out/u
];
const destinationFor = (target) => {
	if (target.user === void 0) return target.host;
	return `${target.user}@${target.host}`;
};
const buildSshArgs = (target) => {
	const base = [
		"-o",
		`ConnectTimeout=${SSH_CONNECT_TIMEOUT_SECONDS}`,
		"-o",
		"BatchMode=yes"
	];
	const destination = destinationFor(target);
	if (target.port === void 0) return [
		...base,
		"-T",
		destination
	];
	return [
		...base,
		"-p",
		target.port,
		"-T",
		destination
	];
};
/** `-o BatchMode=yes` prevents an interactive password/passphrase prompt from ever blocking this
* probe; `-o ConnectTimeout=<n>` is the task brief's "5s timeout" for the connection phase only —
* `timeoutMs` (passed straight to the injected `Runner`, which `ExecaRunner` wires to execa's own
* `timeout` option) bounds the whole probe, including anything after the connection succeeds, AND
* — unlike a hand-rolled race — actually kills the underlying `ssh` child on expiry rather than
* abandoning it to keep running (and keep this short-lived CLI process alive) after doctor has
* already reported. Any exit code is accepted: GitHub's own successful `ssh -T` documented
* behaviour actually exits 1 — including, genuinely, `124`, so the timeout branch below must key
* off `result.timedOut` (set only by an actual `Runner`-level timeout), never `exitCode` alone, or
* a real exit-124 child would be misreported as "probe timed out". Only `stderr` containing
* "Permission denied" counts as an auth failure; a handful of other clear connection-level
* failures are tiered to `warn` instead (see `CONNECTION_WARN_PATTERNS` above) — checked in this
* order so an actual exec-level timeout is never miscategorized as a "connection timed out"
* warning. */
const probeSshHost = async (ctx, target, timeoutMs) => {
	const host = displayFor(target);
	const result = await ctx.runner.run("ssh", buildSshArgs(target), { timeoutMs });
	if (result.timedOut === true) return {
		host,
		outcome: "timeout"
	};
	if (PERMISSION_DENIED_PATTERN.test(result.stderr)) return {
		host,
		outcome: "denied"
	};
	if (CONNECTION_WARN_PATTERNS.some((pattern) => pattern.test(result.stderr))) return {
		detail: result.stderr.trim(),
		host,
		outcome: "connection-warn"
	};
	return {
		host,
		outcome: "ok"
	};
};
/** Each of the four `*Result` helpers below (timeout/denied/connection-warn/ok) owns exactly one
* outcome tier, checked in that priority order — split out of a single `buildSshAuthResult` purely
* to keep it (and each helper) under the repo's `max-statements` cap. */
const timeoutResult = (probes, timeoutMs) => {
	const timedOutHosts = probes.filter((probe) => probe.outcome === "timeout").map((probe) => probe.host);
	if (timedOutHosts.length === EMPTY_LENGTH$2) return;
	return {
		detail: `ssh probe timed out after ${timeoutMs / MS_PER_SECOND}s: ${timedOutHosts.join(", ")}`,
		name: "ssh-auth",
		status: "fail"
	};
};
const deniedResult = (probes) => {
	const deniedHosts = probes.filter((probe) => probe.outcome === "denied").map((probe) => probe.host);
	if (deniedHosts.length === EMPTY_LENGTH$2) return;
	return {
		detail: `ssh permission denied for: ${deniedHosts.join(", ")}`,
		name: "ssh-auth",
		status: "fail"
	};
};
const connectionWarnResult = (probes) => {
	const warnProbes = probes.filter((probe) => probe.outcome === "connection-warn");
	if (warnProbes.length === EMPTY_LENGTH$2) return;
	return {
		detail: `ssh connection issue, treated as warn: ${warnProbes.map((probe) => `${probe.host} (${probe.detail ?? ""})`).join("; ")}`,
		name: "ssh-auth",
		status: "warn"
	};
};
const okResult = (probes) => ({
	detail: `ssh auth ok for: ${probes.map((probe) => probe.host).join(", ")}`,
	name: "ssh-auth",
	status: "ok"
});
const buildSshAuthResult = (probes, timeoutMs) => timeoutResult(probes, timeoutMs) ?? deniedResult(probes) ?? connectionWarnResult(probes) ?? okResult(probes);
const checkSshAuth = async (ctx, config, opts) => {
	const targets = uniqueSshTargets(config);
	if (targets.length === EMPTY_LENGTH$2) return;
	const timeoutMs = opts?.timeoutMs ?? SSH_PROBE_TIMEOUT_MS;
	const probes = await Promise.all(targets.map((target) => probeSshHost(ctx, target, timeoutMs)));
	return buildSshAuthResult(probes, timeoutMs);
};

//#endregion
//#region src/commands/doctor.ts
/** Runs a single step, converting an unexpected throw into a `fail` result labeled with the step's
* own `name` rather than letting it escape and abort every other check — the one property this
* whole module exists to guarantee (see the module doc comment above). A check that returns its
* own `fail`/`warn`/`ok` result never reaches the `catch` at all; this only ever fires for a bug or
* an unhandled OS fault inside the check itself. */
const runStepSafely = async (step) => {
	try {
		return await step.run();
	} catch (error) {
		return {
			detail: `check crashed: ${errorMessageOf(error)}`,
			name: step.name,
			status: "fail"
		};
	}
};
/** Runs `steps` one at a time, strictly in order — never `Promise.all`, so two checks that both
* shell out via the same injected `Runner` (e.g. `hooks-guard`'s and `dirty-checkouts`' per-checkout
* git calls) produce a deterministic, spec-ordered call sequence instead of an interleaving that
* would depend on each check's own internal await shape. Recursive (mirroring
* `remove.ts#pruneEmptyParents`'s "recursive rather than an imperative loop" discipline) purely to
* keep this function's own statement count trivial regardless of how many checks exist. */
const runStepsInOrder = async (steps) => {
	const [step, ...rest] = steps;
	if (step === void 0) return [];
	const result = await runStepSafely(step);
	const remaining = await runStepsInOrder(rest);
	if (result === void 0) return remaining;
	return [result, ...remaining];
};
const buildCheckSteps = (load) => {
	const { configLoad, ctx, home, state } = load;
	return [
		{
			name: "git",
			run: () => checkGit(ctx)
		},
		{
			name: "node",
			run: () => Promise.resolve(checkNode(ctx))
		},
		{
			name: "config",
			run: () => Promise.resolve(buildConfigCheck(configLoad.errorMessage))
		},
		{
			name: "hooks-guard",
			run: () => checkHooksGuard(ctx, home, configLoad.config)
		},
		{
			name: "dirty-checkouts",
			run: () => checkDirtyCheckouts(ctx, home, configLoad.config)
		},
		{
			name: "orphans",
			run: () => checkOrphans(home, configLoad.config, state)
		},
		{
			name: "skill",
			run: () => checkSkill(ctx)
		},
		{
			name: "ssh-auth",
			run: () => checkSshAuth(ctx, configLoad.config)
		}
	];
};
const runDoctor = async (ctx) => {
	const home = resolveHome(ctx.env);
	const configLoad = await loadConfigSafely(home);
	const state = await loadStateSafely(home);
	return runStepsInOrder(buildCheckSteps({
		configLoad,
		ctx,
		home,
		state
	}));
};
const STATUS_LABEL$1 = {
	fail: "FAIL",
	ok: "OK",
	warn: "WARN"
};
const doctorHuman = (checks) => checks.map((check) => `[${STATUS_LABEL$1[check.status]}] ${check.name}: ${check.detail}`);
const hasFailure = (checks) => checks.some((check) => check.status === "fail");
const registerDoctor = (program, ctx) => {
	program.command("doctor").description("Run environment/integrity checks (git, node, config, hooks, checkouts, ssh).").action((_localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const checks = await runDoctor(ctx);
			emit(ctx, opts, doctorHuman(checks), { checks });
			if (hasFailure(checks)) process.exitCode = EXIT.UNEXPECTED;
		})();
	});
};

//#endregion
//#region src/commands/migrate.ts
const runMigrate = async (ctx) => {
	const home = resolveHome(ctx.env);
	const result = await withLock(home, "home", () => migrateConfig(home, version));
	if (result === "migrated") return {
		backup: configBackupPath(home),
		result
	};
	return {
		backup: null,
		result
	};
};
const migrateHuman = (data) => {
	if (data.result === "migrated" && data.backup !== null) return `config migrated (backup: ${basename(data.backup)})`;
	if (data.result === "seeded") return "config seeded";
	return "config up to date";
};
const registerMigrate = (program, ctx) => {
	program.command("migrate").description("Migrate the refs config to the current schema, seeding it if absent.").action((_localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const data = await runMigrate(ctx);
			emit(ctx, opts, migrateHuman(data), data);
		})();
	});
};

//#endregion
//#region src/commands/ref-status.ts
/** Whether a ref's last fetch is stale relative to `ttlMs`: always stale when it has never been
* fetched (`lastFetchedAt` undefined), otherwise stale once `now` is more than `ttlMs` past it. */
const isStale = (lastFetchedAt, ttlMs, now) => {
	if (lastFetchedAt === void 0) return true;
	return now - Date.parse(lastFetchedAt) > ttlMs;
};

//#endregion
//#region src/commands/list.ts
const EMPTY_LENGTH$1 = 0;
const SINGLE_MATCH$1 = 1;
const buildListItem = (args, key, ref) => {
	const refState = args.state.refs[key];
	const ttlMs = durationToMs(resolveSetting("sync_ttl", ref, args.settings));
	return {
		clone_mode: resolveSetting("clone_mode", ref, args.settings),
		description: ref.description,
		key,
		missing: !isGitCheckout(checkoutPath(args.home, zRefKey.parse(key))),
		packages: Object.keys(ref.packages ?? {}).toSorted(),
		stale: isStale(refState?.last_fetched_at, ttlMs, args.now)
	};
};
const listItems = (args) => {
	const itemArgs = {
		home: args.home,
		now: args.now,
		settings: args.config.settings,
		state: args.state
	};
	return Object.entries(args.config.refs).map(([key, ref]) => buildListItem(itemArgs, key, ref)).toSorted((left, right) => left.key.localeCompare(right.key));
};
const runList = async (ctx) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const state = await readState(home);
	return listItems({
		config,
		home,
		now: Date.now(),
		state
	});
};
const suffixesFor = (item) => {
	const suffixes = [];
	if (item.stale) suffixes.push("[stale]");
	if (item.missing) suffixes.push("[missing]");
	if (suffixes.length === EMPTY_LENGTH$1) return "";
	return ` ${suffixes.join(" ")}`;
};
const NO_REFS_LINE = "no refs configured — run: refs add <source>";
const listHuman = (items) => {
	if (items.length === EMPTY_LENGTH$1) return [NO_REFS_LINE];
	return items.map((item) => `${item.key}  ${item.description}${suffixesFor(item)}`);
};
const keySegments = (key) => key.split("/");
const matchesQuery = (key, querySegments) => {
	const segments = keySegments(key);
	if (querySegments.length > segments.length) return false;
	const offset = segments.length - querySegments.length;
	return querySegments.every((segment, index) => segment === segments[offset + index]);
};
/** Resolves `query` (a full ref key, or a unique suffix matched on segment boundaries from the
* right — e.g. `next.js` or `vercel/next.js` both match `github.com/vercel/next.js`) against
* `config.refs`. An exact full-key match wins immediately, even when some other configured key's
* suffix also happens to equal `query` (e.g. `github.com/vercel/next.js` vs.
* `corp-mirror/github.com/vercel/next.js`) — otherwise a ref would be unresolvable by its own full
* key. Throws `usageError` (listing every candidate) when more than one key matches, and
* `notFoundError` when none do. */
const matchRefKey = (config, query) => {
	if (Object.hasOwn(config.refs, query)) return zRefKey.parse(query);
	const querySegments = keySegments(query);
	const matches = Object.keys(config.refs).filter((key) => matchesQuery(key, querySegments)).toSorted();
	const [first] = matches;
	if (first === void 0) throw notFoundError(`no ref matches '${query}'`);
	if (matches.length > SINGLE_MATCH$1) throw usageError(`'${query}' matches more than one ref: ${matches.join(", ")}`);
	return zRefKey.parse(first);
};
const registerList = (program, ctx) => {
	program.command("list").description("List configured refs with their staleness/missing checkout status.").action((_localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const items = await runList(ctx);
			emit(ctx, opts, listHuman(items), items);
		})();
	});
};

//#endregion
//#region src/commands/add-helpers.ts
const NPM_PREFIX = "npm:";
const REF_LOCK_PREFIX = "ref:";
const ALLOW_FILE_URLS_FLAG = "1";
/** Per-ref advisory lock name for `key` — `/` replaced by `_` since lock names are joined verbatim
* onto `locksDir` (see `lock.ts`'s allowlist). Shared by the dry-run clone step and the finalize
* identity/head checks so both ever use the exact same name for a given ref. */
const refLockName = (key) => `${REF_LOCK_PREFIX}${key.replaceAll("/", "_")}`;
/** Whether `REFS_ALLOW_FILE_URLS=1` is set — the same escape hatch `canonicalizeGitUrl` itself
* gates its `file:` support on. Threaded through everywhere this module re-derives a repo's
* canonical identity (checkout reuse, finalize-time origin/head checks), not just initial source
* resolution, so `file://` fixtures keep working end to end under test. */
const allowFileUrlsFrom = (env) => env["REFS_ALLOW_FILE_URLS"] === ALLOW_FILE_URLS_FLAG;
const resolveGitUrlSource = (ctx, source) => {
	const canonical = canonicalizeGitUrl(source, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
	return {
		cloneUrl: canonical.cloneUrl,
		key: canonical.key
	};
};
const resolveNpmSource = async (ctx, pkgName) => {
	if (pkgName === "") throw usageError("refs add npm: requires a package name, e.g. npm:left-pad");
	const resolved = await resolveNpmPackage(ctx.fetcher, pkgName);
	const result = {
		cloneUrl: resolved.cloneUrl,
		key: resolved.key,
		npmPkgName: pkgName
	};
	if (resolved.directory !== void 0) result.npmDirectory = resolved.directory;
	return result;
};
/** Resolves `<source>` — either `npm:<pkg>` (via the registry) or a direct git url (canonicalized,
* honouring `REFS_ALLOW_FILE_URLS=1` for `file://` fixtures/tests) — into a clone url + ref key. */
const resolveAddSource = (ctx, source) => {
	if (source.startsWith(NPM_PREFIX)) return resolveNpmSource(ctx, source.slice(4));
	return Promise.resolve(resolveGitUrlSource(ctx, source));
};
/** Spec §3 transport rule: a url the user typed explicitly is used verbatim — typing the url IS
* choosing the transport — so only `npm:`-resolved sources are rewritten to the configured
* `git_transport`, before cloning and before the url lands in the proposal/config entry. A NEW
* ref cannot carry a per-ref override yet, so the global setting governs (`ref` = undefined). The
* canonical key is transport-invariant (asserted inside `applyGitTransport`), so every guard and
* path derivation keyed on `resolved.key` is unaffected by the rewrite. */
const applyConfiguredTransport = (resolved, settings) => {
	if (resolved.npmPkgName === void 0) return resolved;
	const transport = resolveSetting("git_transport", void 0, settings);
	return {
		...resolved,
		cloneUrl: applyGitTransport(resolved.cloneUrl, transport)
	};
};
const conflictMessage = (key) => `ref '${key}' already exists — use refs edit or refs remove`;
/** Throws `conflictError` when `key` is already a configured ref — checked once (best-effort)
* before cloning and again under the home lock at finalize time (race-safe). */
const ensureNoConflict = (config, key) => {
	if (config.refs[key] !== void 0) throw conflictError(conflictMessage(key));
};
const readDirSafe = async (dir) => {
	try {
		return await readdir(dir, { withFileTypes: true });
	} catch (error) {
		if (isEnoent(error)) return;
		throw error;
	}
};
const dirNamesOf = (entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
const stepSegment = async (currentDir, segment) => {
	const entries = await readDirSafe(currentDir);
	if (entries === void 0) return { kind: "stop" };
	const dirNames = dirNamesOf(entries);
	if (dirNames.includes(segment)) return {
		kind: "continue",
		nextDir: join(currentDir, segment)
	};
	const collided = dirNames.find((name) => name.toLowerCase() === segment.toLowerCase());
	if (collided === void 0) return { kind: "stop" };
	return {
		kind: "collision",
		name: collided
	};
};
/** Walks the existing directory tree under `sourcesDir` one key segment at a time (recursively, so
* no single function carries the whole loop's statement count), looking for a directory whose name
* matches the next segment case-INsensitively but not exactly. */
const descend = async (currentDir, remaining, matchedSoFar) => {
	const [segment, ...rest] = remaining;
	if (segment === void 0) return;
	const step = await stepSegment(currentDir, segment);
	if (step.kind === "stop") return;
	if (step.kind === "collision") return [...matchedSoFar, step.name].join("/");
	return descend(step.nextDir, rest, [...matchedSoFar, segment]);
};
const NO_MATCHES = [];
/** Throws `conflictError` when an existing `sources/` directory collides with `key` only in case
* (e.g. `github.com/Owner/repo` vs. `github.com/owner/repo`) — such checkouts would alias on a
* case-insensitive filesystem even though the config keys are textually distinct. */
const ensureNoCaseCollision = async (home, key) => {
	const collision = await descend(home.sourcesDir, key.split("/"), NO_MATCHES);
	if (collision !== void 0) throw conflictError(`checkout path for '${key}' collides case-insensitively with existing '${collision}'`);
};

//#endregion
//#region src/commands/remove.ts
const MISSING_CHECKOUT_WARNING = "checkout was already missing";
const EMPTY_ENTRIES = 0;
const NO_WARNINGS$4 = [];
const warningsFor$1 = (warning) => {
	if (warning === void 0) return NO_WARNINGS$4;
	return [warning];
};
/** `lstat` rather than `stat` — a DANGLING symlink at `dest` (target missing) must still count as
* present: `stat` follows the link and would report ENOENT for it, silently skipping the guarded
* `rm` below and leaving an unmanaged symlink entry under `sources/`. `lstat` sees any fs entry at
* the path (directory, file, or symlink, dangling or not) without following it. */
const checkoutExists = async (dest) => {
	try {
		await lstat(dest);
		return true;
	} catch (error) {
		if (isEnoent(error)) return false;
		throw error;
	}
};
/** `readdir(dir)`, or `undefined` if `dir` is already gone — mirrors `add-helpers.ts#readDirSafe`
* (same reasoning: an ENOENT here just means a concurrent pruner or the destructive removal above
* already won the race, not a real error). */
const readdirSafe = async (dir) => {
	try {
		return await readdir(dir);
	} catch (error) {
		if (isEnoent(error)) return;
		throw error;
	}
};
/** `true`/`false` if `dir` exists (a real directory, or not — most notably a symlink, including
* one that resolves to a directory), `undefined` if nothing is there at all. `lstat`, not `stat`,
* so a symlinked ancestor is reported as itself, never silently followed. */
const isRealDirectory = async (dir) => {
	try {
		return (await lstat(dir)).isDirectory();
	} catch (error) {
		if (isEnoent(error)) return;
		throw error;
	}
};
/** The actual `readdir`-then-`rmdir` removal, once `removeIfEmpty` has already confirmed `dir` is
* a real directory — split out purely to keep `removeIfEmpty` itself under the repo's
* `max-statements` cap. Same "gone either way" contract as `removeIfEmpty`. */
const removeEmptyDirectory = async (dir) => {
	const entries = await readdirSafe(dir);
	if (entries === void 0) return true;
	if (entries.length !== EMPTY_ENTRIES) return false;
	try {
		await rmdir(dir);
	} catch (error) {
		if (!isEnoent(error)) throw error;
	}
	return true;
};
/** Removes `dir` if it exists and is now empty, reporting back whether pruning should continue
* upward — `true` when `dir` itself is gone (either it was already gone, or this call just removed
* it), `false` the moment it turns out to be non-empty (some other entry still lives there) OR
* turns out not to be a real directory at all. */
const removeIfEmpty = async (dir) => {
	const realDirectory = await isRealDirectory(dir);
	if (realDirectory === void 0) return true;
	if (!realDirectory) return false;
	return removeEmptyDirectory(dir);
};
/** Removes now-empty ancestor directories starting at `dir`, walking upward one level at a time,
* stopping at (and never removing) `home.sourcesDir` itself — e.g. deleting the sole checkout
* under `github.com/vercel/` also prunes that now-empty `vercel/` directory, and `github.com/`
* above it if that too is now empty, but `sources/` always survives. Recursive (one `await` per
* call, mirroring `lock.ts#acquireWithRetry`'s "recursive rather than a loop" discipline) rather
* than an imperative loop, purely to keep every function under the repo's `max-statements` cap. */
const pruneEmptyParents = async (home, dir) => {
	if (dir === home.sourcesDir) return;
	if (!await removeIfEmpty(dir)) return;
	await pruneEmptyParents(home, dirname(dir));
};
/** Deletes the checkout at `dest` if one is present, containment-checked via `assertInsideSources`
* immediately before the actual `fs.rm` — per `home.ts`'s destructive-caller contract, which names
* `refs remove` explicitly as the guard's intended caller — then prunes now-empty parent
* directories. A checkout that is already absent is not an error: it is reported back as a warning
* so the caller still proceeds to remove the config/state entry.
*
* Residual TOCTOU: `assertInsideSources` re-checks containment then `rm` runs after — a window a
* concurrent arbitrary filesystem writer could in principle race; accepted for a local single-user
* tool, same adjudication as `workspaces.ts`'s `isContainedInRepo` note and `home.ts`'s own guard
* doc. No structural fix here.
*
* Two-phase ordering note: if `pruneEmptyParents` throws (e.g. some other unexpected fs error) it
* does so AFTER the checkout itself is already gone but BEFORE `runRemove` drops the config/state
* entry — deliberately: that failure surfaces loudly, `refs list` still shows the ref, and a re-run
* of `refs remove` is a safe, idempotent way to finish the job (`checkoutExists` sees nothing left
* to remove and `dropRefEntries` clears the now-stale entry). */
const removeCheckout = async (home, dest) => {
	if (!await checkoutExists(dest)) return {
		removedCheckout: false,
		warning: MISSING_CHECKOUT_WARNING
	};
	assertInsideSources(home, dest);
	await rm(dest, {
		force: true,
		recursive: true
	});
	await pruneEmptyParents(home, dirname(dest));
	return { removedCheckout: true };
};
/** Builds a copy of `record` with `key` omitted — via `Object.fromEntries`/`filter` rather than
* `delete record[key]`, so config/state objects are never mutated in place. */
const withoutKey = (record, key) => Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
/** Drops `key` from both `config.refs` and `state.refs` under the shared `'home'` lock — the same
* lock every other config/state mutation in the CLI takes (init, edit, add's finalize step, sync's
* state updates) — so this can never race a concurrent `refs edit`/`refs add`/`refs sync`. Re-reads
* both files fresh under the lock rather than reusing an earlier read, mirroring
* `add-helpers.ts#ensureNoConflict`'s "checked once outside, re-verified inside the lock"
* discipline. A key already absent (e.g. dropped by a racing caller) is a harmless no-op. */
const dropRefEntries = async (home, key) => {
	const config = await readConfig(home);
	await writeConfig(home, {
		...config,
		refs: withoutKey(config.refs, key)
	});
	const state = await readState(home);
	await writeState(home, {
		...state,
		refs: withoutKey(state.refs, key)
	});
};
const runRemove = async (ctx, query) => {
	const home = resolveHome(ctx.env);
	const key = matchRefKey(await readConfig(home), query);
	const dest = checkoutPath(home, key);
	const { removedCheckout, warning } = await withLock(home, refLockName(key), () => removeCheckout(home, dest));
	await withLock(home, "home", () => dropRefEntries(home, key));
	return {
		data: {
			key,
			removed_checkout: removedCheckout
		},
		warnings: warningsFor$1(warning)
	};
};
const removeHuman = (data) => {
	if (data.removed_checkout) return [`removed ${data.key} (checkout deleted)`];
	return [`removed ${data.key} (checkout was already missing)`];
};
const registerRemove = (program, ctx) => {
	program.command("remove").description("Remove a configured ref: its config/state entry AND its checkout directory.").argument("<ref>", "full ref key or a unique suffix, e.g. next.js").action((ref, _localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const { data, warnings } = await runRemove(ctx, ref);
			emit(ctx, opts, removeHuman(data), data, warnings);
		})();
	});
};

//#endregion
//#region src/commands/resolve.ts
const PREFIX_START = 0;
const PREFIX_STEP = 1;
const SINGLE_MATCH = 1;
const notFoundMessage = (query) => `no ref matches '${query}' — run refs list, or add it: refs add <url>`;
const URL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:\/\//iu;
const SCP_URL_SHAPE = /^git@[^:/\s]+:[^\s]+$/u;
const looksLikeGitUrl = (query) => URL_SCHEME_PATTERN.test(query) || SCP_URL_SHAPE.test(query);
const notCanonicalizableMessage = "query looks like a git url but is not a supported form — check the url (credentials are never accepted) or run: refs resolve <package|ref-suffix>";
const canonicalizeOrUndefined = (query, options) => {
	try {
		return canonicalizeGitUrl(query, options);
	} catch {
		if (looksLikeGitUrl(query)) throw validationError(notCanonicalizableMessage);
		return;
	}
};
const tryUrlRoute = (config, query, options) => {
	const canonical = canonicalizeOrUndefined(query, options);
	if (canonical === void 0) return;
	if (Object.hasOwn(config.refs, canonical.key)) return { key: canonical.key };
	throw notFoundError(notFoundMessage(query));
};
const packageMatchesFor = (config, name) => {
	const matches = [];
	for (const key of Object.keys(config.refs).toSorted()) {
		const entry = config.refs[key]?.packages?.[name];
		if (entry !== void 0) matches.push({
			entry,
			key: zRefKey.parse(key)
		});
	}
	return matches;
};
const ambiguousPackageMessage = (name, keys) => `package '${name}' is registered by more than one ref: ${keys.join(", ")} — use the full ref key`;
const findPackageByName = (config, name) => {
	const matches = packageMatchesFor(config, name);
	const [first] = matches;
	if (first === void 0) return;
	if (matches.length > SINGLE_MATCH) throw usageError(ambiguousPackageMessage(name, matches.map((match) => match.key)));
	return first;
};
const findPackageByPrefix = (config, query) => {
	const segments = query.split("/");
	for (let length = segments.length - PREFIX_STEP; length >= PREFIX_STEP; length -= PREFIX_STEP) {
		const candidate = segments.slice(PREFIX_START, length).join("/");
		const found = findPackageByName(config, candidate);
		if (found !== void 0) return {
			...found,
			name: candidate
		};
	}
};
const matchSuffixOrThrow = (config, query) => {
	try {
		return matchRefKey(config, query);
	} catch (error) {
		if (error instanceof RefsError && error.code === "not_found") throw notFoundError(notFoundMessage(query));
		throw error;
	}
};
const routeQuery = (config, query, options) => {
	const urlMatch = tryUrlRoute(config, query, options);
	if (urlMatch !== void 0) return urlMatch;
	const exact = findPackageByName(config, query);
	if (exact !== void 0) return {
		key: exact.key,
		packageMatch: {
			...exact,
			name: query
		}
	};
	const prefixed = findPackageByPrefix(config, query);
	if (prefixed !== void 0) return {
		key: prefixed.key,
		packageMatch: prefixed
	};
	return { key: matchSuffixOrThrow(config, query) };
};
const requireEntry$4 = (config, key) => {
	const entry = config.refs[key];
	if (entry === void 0) throw new Error(`internal: resolved ref key '${key}' is missing from config.refs`);
	return entry;
};
const packageDataFor = (match, dest) => {
	if (match.packageMatch === void 0) return null;
	const { entry, name } = match.packageMatch;
	return {
		local_path: join(dest, entry.path),
		name,
		path: entry.path
	};
};
const runResolve = async (ctx, query) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const match = routeQuery(config, query, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
	const entry = requireEntry$4(config, match.key);
	const state = await readState(home);
	const dest = checkoutPath(home, match.key);
	const ttlMs = durationToMs(resolveSetting("sync_ttl", entry, config.settings));
	return {
		key: match.key,
		local_path: dest,
		missing: !isGitCheckout(dest),
		package: packageDataFor(match, dest),
		stale: isStale(state.refs[match.key]?.last_fetched_at, ttlMs, Date.now())
	};
};
const resolveHuman = (data) => {
	const lines = [data.key, `local_path: ${data.local_path}`];
	if (data.package !== null) lines.push(`package: ${data.package.name}`, `local_path: ${data.package.local_path}`);
	return lines;
};
const registerResolve = (program, ctx) => {
	program.command("resolve").description("Resolve a git url, npm package name, import path, or ref-key suffix to its ref/package.").argument("<query>", "git url, npm package name, import path, or unique ref-key suffix").action((query, _localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const data = await runResolve(ctx, query);
			emit(ctx, opts, resolveHuman(data), data);
		})();
	});
};

//#endregion
//#region src/commands/show.ts
const SAMPLE_TAG_LIMIT = 5;
const EMPTY_LENGTH = 0;
const EMPTY_STATE = {};
const requireEntry$3 = (config, key) => {
	const entry = config.refs[key];
	if (entry === void 0) throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
	return entry;
};
const errorDetail$1 = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
const sampleTagsFor = async (ctx, dest) => {
	if (!isGitCheckout(dest)) return { tags: [] };
	try {
		return { tags: await listTags(ctx.runner, dest, SAMPLE_TAG_LIMIT) };
	} catch (error) {
		return {
			tags: [],
			warning: `could not list tags: ${errorDetail$1(error)}`
		};
	}
};
const NO_WARNINGS$3 = [];
const warningsFor = (warning) => {
	if (warning === void 0) return NO_WARNINGS$3;
	return [warning];
};
const runShow = async (ctx, query) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const key = matchRefKey(config, query);
	const entry = requireEntry$3(config, key);
	const state = await readState(home);
	const dest = checkoutPath(home, key);
	const { tags: sampleTags, warning } = await sampleTagsFor(ctx, dest);
	return {
		data: {
			...entry,
			key,
			local_path: dest,
			sample_tags: sampleTags,
			state: state.refs[key] ?? EMPTY_STATE
		},
		warnings: warningsFor(warning)
	};
};
const showHuman = (data) => {
	const lines = [
		`${data.key}  ${data.description}`,
		`url: ${data.url}`,
		`local_path: ${data.local_path}`
	];
	if (data.sample_tags.length > EMPTY_LENGTH) lines.push(`tags: ${data.sample_tags.join(", ")}`);
	return lines;
};
const registerShow = (program, ctx) => {
	program.command("show").description("Show a configured ref: full entry, state, local path, and sample tags.").argument("<ref>", "full ref key or a unique suffix, e.g. next.js").action((ref, _localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const { data, warnings } = await runShow(ctx, ref);
			emit(ctx, opts, showHuman(data), data, warnings);
		})();
	});
};

//#endregion
//#region src/commands/sync-state.ts
/** Builds `key`'s next `RefState` on a successful sync/clone: a fresh object (not a spread of
* `previous`) so a prior `last_error`/`pending_proposal_at` is dropped on success rather than
* lingering — only `effective_clone_mode` is deliberately carried over when this round didn't
* reclone (and so has no fresher value of its own). */
const buildSyncedState = (previous, outcome) => {
	const next = {
		head_sha: outcome.headSha,
		last_fetched_at: (/* @__PURE__ */ new Date()).toISOString()
	};
	const effectiveCloneMode = outcome.effectiveCloneMode ?? previous?.effective_clone_mode;
	if (effectiveCloneMode !== void 0) next.effective_clone_mode = effectiveCloneMode;
	return next;
};
/** Persists a detected branch rename onto the configured ref's `default_branch` — a no-op if the
* ref has meanwhile been removed from config (defensive only; `sync`'s targets are always read
* from config moments earlier). */
const renameDefaultBranch = async (home, key, branch) => {
	const config = await readConfig(home);
	const entry = config.refs[key];
	if (entry === void 0) return;
	config.refs[key] = {
		...entry,
		default_branch: branch
	};
	await writeConfig(home, config);
};
/** Persists a successful sync's config/state effects under one short home-lock acquisition. */
const applySyncSuccess = (home, key, outcome) => withLock(home, "home", async () => {
	if (outcome.branchRenamedTo !== void 0) await renameDefaultBranch(home, key, outcome.branchRenamedTo);
	const state = await readState(home);
	state.refs[key] = buildSyncedState(state.refs[key], outcome);
	await writeState(home, state);
});
/** Best-effort: records `message` as `key`'s `last_error` under a short home lock, preserving
* every other field already in state. A failure here (e.g. lock contention) must never mask the
* real sync failure the caller is already about to report, so it is swallowed rather than thrown —
* the batch's result item for `key` still carries the original error either way. */
const recordFailure = async (home, key, message) => {
	try {
		await withLock(home, "home", async () => {
			const state = await readState(home);
			state.refs[key] = {
				...state.refs[key],
				last_error: message
			};
			await writeState(home, state);
		});
	} catch {}
};

//#endregion
//#region src/commands/sync-semaphore.ts
const SLOT_STEP = 1;
const createSemaphore = (limit) => {
	let active = 0;
	const queue = [];
	const release = () => {
		active -= SLOT_STEP;
		const wake = queue.shift();
		if (wake !== void 0) wake();
	};
	const acquire = () => {
		if (active < limit) {
			active += SLOT_STEP;
			return Promise.resolve();
		}
		const { promise, resolve } = Promise.withResolvers();
		queue.push(() => {
			active += SLOT_STEP;
			resolve();
		});
		return promise;
	};
	return {
		acquire,
		release
	};
};
/** Runs `fn` once a semaphore slot is free, always releasing it afterwards (success or throw). */
const runGated = async (sem, fn) => {
	await sem.acquire();
	try {
		return await fn();
	} finally {
		sem.release();
	}
};

//#endregion
//#region src/commands/add-checkout-guards.ts
const SUCCESS_EXIT_CODE$1 = 0;
const originMismatchMessage = (dest, actual, expectedUrl) => `checkout at ${dest} points at '${actual}' — expected '${expectedUrl}'; remove the checkout directory or run refs remove before retrying`;
const NO_ORIGIN_MARKER = "(no origin remote)";
/** Verifies `opts.dest`'s `origin` remote points at `opts.expectedUrl` — guards against reusing or
* finalizing against a directory that merely happens to occupy the derived checkout path but is an
* unrelated or unmanaged repo (leftover from another tool, a moved/renamed remote, etc.). A failed
* `git remote get-url origin` (not a repo, no such remote) is treated as a mismatch too, rendered
* as `(no origin remote)` in the error rather than surfacing raw git stderr. */
const originOrMarker = (result) => {
	if (result.exitCode === SUCCESS_EXIT_CODE$1) return result.stdout.trim();
	return NO_ORIGIN_MARKER;
};
/** Canonicalizes `url` into its identity `key`, or `undefined` when it doesn't even parse as a
* supported git url (an exotic/unsupported remote form) — callers treat that as a mismatch (fail
* closed) rather than letting an uncomparable origin slide through unchecked. */
const originIdentityKey = (url, allowFileUrls) => {
	try {
		return canonicalizeGitUrl(url, { allowFileUrls }).key;
	} catch {
		return;
	}
};
/** Verifies `opts.dest`'s `origin` remote resolves to the SAME repo IDENTITY as `opts.expectedUrl`
* — compared via `canonicalizeGitUrl`'s canonical `key`, not byte-exact url equality. This
* deliberately tolerates cosmetic variance (a trailing `.git`, host casing) and even transport
* differences (`ssh://` vs `https://` of the same repo), treating them as the same identity. A
* failed `git remote get-url origin` (not a repo, no such remote) — or EITHER side (actual origin
* or `opts.expectedUrl` itself) failing to canonicalize (some exotic/unsupported remote form) — is
* treated as a mismatch too (fail closed, via `originIdentityKey`'s shared `undefined`-on-failure
* handling for both sides), rendered as `(no origin remote)` in the error rather than surfacing raw
* git stderr, or letting an uncomparable `opts.expectedUrl` slip through as a generic parse error
* instead of this guard's actionable conflict message. */
const ensureCheckoutOrigin = async (runner, opts) => {
	const result = await runner.run("git", [
		"remote",
		"get-url",
		"origin"
	], { cwd: opts.dest });
	const actual = originOrMarker(result);
	const expectedKey = originIdentityKey(opts.expectedUrl, opts.allowFileUrls);
	const actualKey = originIdentityKey(actual, opts.allowFileUrls);
	if (expectedKey !== void 0 && actualKey === expectedKey) return;
	throw conflictError(originMismatchMessage(opts.dest, actual, opts.expectedUrl));
};
const unmanagedCheckoutMessage = (dest) => `checkout at ${dest} exists but is not refs-managed — remove it (rm -rf ${dest}) and retry`;
/** Reuse-path-only guard: confirms `dest` is a checkout `refs` itself produced — the `cloneRepo`
* marker (`core.hooksPath` pointing at this home's `hooksDir`) — rather than merely a directory
* that happens to occupy the derived path and share the expected origin (e.g. a manual `git
* clone` of the same repo, made before `refs add` ever ran against it). Adopting such a checkout
* silently would be unsafe: a later `refs sync` hard-resets/cleans it (see `syncRef` in core),
* which would destroy any history or work-in-progress the manual clone carried. Never applied
* after a fresh clone — `cloneRepo` always stamps the marker itself, so a checkout we just created
* is trusted unconditionally. */
const ensureManagedCheckout = async (runner, opts) => {
	const result = await runner.run("git", [
		"config",
		"--local",
		"core.hooksPath"
	], { cwd: opts.dest });
	if (result.exitCode !== SUCCESS_EXIT_CODE$1 || result.stdout.trim() !== opts.hooksDir) throw conflictError(unmanagedCheckoutMessage(opts.dest));
};
/** Idempotent clone: reuses an already-healthy checkout (a `.git` dir already exists at `dest`)
* rather than re-cloning, otherwise clones fresh — creating `dest`'s parent directories first.
* `effectiveMode` is only known (and returned) when a clone actually ran: `cloneRepo` may downgrade
* a requested `'blobless'` clone to `'full'` when the remote doesn't honour the partial-clone
* filter (see `git/repo.ts#cloneRepo`), so callers must not assume the requested mode was used.
* When *reusing* rather than cloning fresh, `opts.dest`'s origin identity must match
* `opts.cloneUrl`'s (see `ensureCheckoutOrigin`) AND `opts.dest` must carry the refs-managed marker
* (see `ensureManagedCheckout`) — a freshly-cloned checkout is trusted unconditionally for both,
* since we just created it (and stamped the marker) ourselves. `opts.dest` is
* containment-checked (`assertInsideSources`) up front, before EITHER branch — an existing
* ancestor path segment under `opts.home.sourcesDir` could be a symlink pointing outside it (e.g.
* a nested ref's checkout turned into a symlink), which would otherwise make the fresh clone
* write outside the managed tree, or make the reuse branch ADOPT a checkout that physically lives
* outside it (`isGitCheckout`'s existsSync follows symlinked ancestors) — every later sync would
* then operate out there. */
const ensureClonedCheckout = async (runner, opts) => {
	assertInsideSources(opts.home, opts.dest);
	if (isGitCheckout(opts.dest)) {
		await ensureCheckoutOrigin(runner, {
			allowFileUrls: opts.allowFileUrls,
			dest: opts.dest,
			expectedUrl: opts.cloneUrl
		});
		await ensureManagedCheckout(runner, {
			dest: opts.dest,
			hooksDir: opts.hooksDir
		});
		return {};
	}
	await mkdir(dirname(opts.dest), { recursive: true });
	const result = await cloneRepo(runner, opts);
	if (result.warning === void 0) return { effectiveMode: result.effectiveMode };
	return {
		effectiveMode: result.effectiveMode,
		warning: result.warning
	};
};
const revParseFailedMessage = (key, dest) => `checkout for '${key}' at ${dest} is missing or corrupt (git rev-parse HEAD failed) — run: refs remove ${key}, then refs add <source> --dry-run again`;
const HEAD_SHA_HEX_LENGTH = 40;
const unsupportedHeadShaMessage$1 = (key, dest, sha) => `checkout for '${key}' at ${dest} has a HEAD sha refs cannot store yet (${sha.length} hex chars, expected ${HEAD_SHA_HEX_LENGTH}) — only SHA-1 repositories are supported for now; \`--object-format=sha256\` repositories are not yet supported`;
/** Resolves the finalize-time `HEAD` sha for `opts.dest`, verifying (in order) that its origin
* identity still matches `opts.expectedUrl` (see `ensureCheckoutOrigin`), that `opts.dest` still
* carries the refs-managed marker (see `ensureManagedCheckout`) — otherwise a checkout dry-run
* created could be swapped out for an unmanaged manual clone of the SAME origin before finalize
* ever runs, which would adopt it (config written) despite `refs sync` later hard-resetting/
* cleaning it (see `ensureManagedCheckout`'s own comment) — that `git rev-parse HEAD` actually
* succeeds — `Runner.run` never throws on a non-zero exit, so a corrupt/removed checkout would
* otherwise hand back garbage `stdout` instead of failing — AND that the resulting sha has the
* exact shape `zState`'s `head_sha` field requires (imported from core, not retyped locally): a
* SHA-256 (`--object-format=sha256`) repo yields a 64-character HEAD, which `writeState` would
* otherwise only catch AFTER `writeConfig` had already landed the ref (see `finalizeRef` in
* `add.ts`). Called under the per-ref lock, strictly before any config/state write, so any of these
* failures is caught before anything is persisted. */
const resolveCheckoutHead = async (runner, opts) => {
	await ensureCheckoutOrigin(runner, opts);
	await ensureManagedCheckout(runner, {
		dest: opts.dest,
		hooksDir: opts.hooksDir
	});
	const headResult = await runner.run("git", ["rev-parse", "HEAD"], { cwd: opts.dest });
	if (headResult.exitCode !== SUCCESS_EXIT_CODE$1) throw validationError(revParseFailedMessage(opts.key, opts.dest));
	const sha = headResult.stdout.trim();
	if (!zRefState.shape.head_sha.safeParse(sha).success) throw validationError(unsupportedHeadShaMessage$1(opts.key, opts.dest, sha));
	return sha;
};

//#endregion
//#region src/commands/sync-checkout.ts
const unsupportedHeadShaMessage = (key, dest, sha) => `sync produced a HEAD sha for '${key}' at ${dest} that refs cannot store yet (${sha.length} hex chars) — only SHA-1 repositories are supported for now`;
/** Validates a freshly-observed HEAD sha against `zRefState`'s exact shape before it is ever
* persisted — mirrors `add-checkout-guards.ts#resolveCheckoutHead`'s own guard, needed again here
* because `syncRef`'s `newSha` comes from a plain `git rev-parse HEAD`, not from that helper. */
const validateHeadSha = (key, dest, sha) => {
	if (!zRefState.shape.head_sha.safeParse(sha).success) throw validationError(unsupportedHeadShaMessage(key, dest, sha));
	return sha;
};
/** Shapes a fresh clone's outcome — split out of `syncMissingCheckout` purely to keep that
* function under the repo's max-statements cap. */
const buildClonedOutcome = (rsc, cloneResult, fields) => {
	const outcome = {
		effectiveCloneMode: cloneResult.effectiveMode,
		headSha: fields.headSha,
		status: "cloned"
	};
	if (fields.actualBranch !== rsc.ref.default_branch) outcome.branchRenamedTo = fields.actualBranch;
	if (cloneResult.warning !== void 0) outcome.warning = cloneResult.warning;
	return outcome;
};
/** Missing-checkout branch: clone fresh (idempotent-clone's non-reuse path), then detect the
* remote's actual default branch — a rename that happened while the checkout was gone would
* otherwise go unnoticed, since a fresh `git clone` simply checks out whatever `origin/HEAD` is
* right now. */
const syncMissingCheckout = async (ctx, rsc, dest) => {
	await mkdir(dirname(dest), { recursive: true });
	const cloneMode = resolveSetting("clone_mode", rsc.ref, rsc.settings);
	const cloneResult = await cloneRepo(ctx.runner, {
		cloneUrl: rsc.ref.url,
		dest,
		hooksDir: rsc.home.hooksDir,
		mode: cloneMode
	});
	const actualBranch = await detectDefaultBranch(ctx.runner, dest);
	const headSha = await resolveCheckoutHead(ctx.runner, {
		allowFileUrls: allowFileUrlsFrom(ctx.env),
		dest,
		expectedUrl: rsc.ref.url,
		hooksDir: rsc.home.hooksDir,
		key: rsc.key
	});
	return buildClonedOutcome(rsc, cloneResult, {
		actualBranch,
		headSha
	});
};
/** Existing-checkout branch: guarded by the exact same managed-checkout marker check `add`'s
* reuse path uses (`core.hooksPath` equals this home's `hooksDir`) AND the same origin-identity
* check `add`'s reuse/finalize paths use (`ensureCheckoutOrigin`) — BOTH before `syncRef` ever
* touches the directory. Without the origin check, a managed checkout whose `origin` remote was
* repointed at an unrelated repo (hand-edited, or swapped out on disk after `refs add`) would get
* fetched/hard-reset onto that OTHER repo's history and have the result persisted as if it were
* the configured ref — silently adopting a different repo's content under the original ref's key.
* A mismatch throws (fail closed) before any git write touches the checkout. */
const syncExistingCheckout = async (ctx, rsc, dest) => {
	await ensureManagedCheckout(ctx.runner, {
		dest,
		hooksDir: rsc.home.hooksDir
	});
	await ensureCheckoutOrigin(ctx.runner, {
		allowFileUrls: allowFileUrlsFrom(ctx.env),
		dest,
		expectedUrl: rsc.ref.url
	});
	const result = await syncRef(ctx.runner, {
		defaultBranch: rsc.ref.default_branch,
		dir: dest
	});
	const outcome = {
		headSha: validateHeadSha(rsc.key, dest, result.newSha),
		status: result.status
	};
	if (result.branchRenamedTo !== void 0) outcome.branchRenamedTo = result.branchRenamedTo;
	if (result.warning !== void 0) outcome.warning = result.warning;
	return outcome;
};
/** Runs the git side of one ref's sync under its per-ref lock only — no config/state write here,
* see `sync-state.ts#applySyncSuccess` for the separate, sequential home-lock step. */
const syncCheckout = (ctx, rsc) => withLock(rsc.home, refLockName(rsc.key), () => {
	const dest = checkoutPath(rsc.home, rsc.key);
	assertInsideSources(rsc.home, dest);
	if (!isGitCheckout(dest)) return syncMissingCheckout(ctx, rsc, dest);
	return syncExistingCheckout(ctx, rsc, dest);
});

//#endregion
//#region src/commands/sync-core.ts
const errorMessage = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
const RENAME_WARNING_SEP = " | ";
/** Merges the branch-rename warning (if any) with `outcome`'s own warning (e.g. a partial-clone
* filter fallback) — both can legitimately fire for the same ref. */
const buildWarning = (outcome) => {
	const parts = [];
	if (outcome.branchRenamedTo !== void 0) parts.push(`default branch renamed to ${outcome.branchRenamedTo}`);
	if (outcome.warning !== void 0) parts.push(outcome.warning);
	const [firstPart] = parts;
	if (firstPart === void 0) return;
	return parts.join(RENAME_WARNING_SEP);
};
const buildSuccessItem = (key, outcome) => {
	const result = {
		key,
		status: outcome.status
	};
	const warning = buildWarning(outcome);
	if (warning !== void 0) result.warning = warning;
	return result;
};
/** One ref, start to finish: git ops under the per-ref lock (`sync-checkout.ts`), then
* config/state persistence under a separate home lock (`sync-state.ts`) — never throws; any
* failure (git op, lock timeout, validation) is caught here and reported as a `'failed'` result
* item instead of aborting the batch. */
const syncOneKey = async (ctx, rsc) => {
	try {
		const outcome = await syncCheckout(ctx, rsc);
		await applySyncSuccess(rsc.home, rsc.key, outcome);
		return buildSuccessItem(rsc.key, outcome);
	} catch (error) {
		const message = errorMessage(error);
		await recordFailure(rsc.home, rsc.key, message);
		return {
			error: message,
			key: rsc.key,
			status: "failed"
		};
	}
};
const SYNC_CONCURRENCY_CAP = 4;
/** Reshapes one `Promise.allSettled` slot back into a `SyncResultItem` — the `'rejected'` branch
* is pure defense-in-depth (`syncOneKey` above already catches everything it can), so the batch
* still degrades to a `'failed'` entry instead of crashing outright if something truly unexpected
* slips past it (e.g. a bug in the semaphore wiring itself). */
const toResultItem = (settled, key) => {
	if (settled.status === "fulfilled") return settled.value;
	return {
		error: errorMessage(settled.reason),
		key,
		status: "failed"
	};
};
/** Syncs every target in `targets`, at most `SYNC_CONCURRENCY_CAP` at a time, via
* `Promise.allSettled` over a tiny inline semaphore (`sync-semaphore.ts`) — the batch never
* aborts: each target's own failure (or, in the defensive fallback above, a rejection `syncOneKey`
* somehow didn't catch) becomes its own `'failed'` result item alongside every other target's real
* outcome. */
const syncAll = async (ctx, targets) => {
	const sem = createSemaphore(SYNC_CONCURRENCY_CAP);
	return (await Promise.allSettled(targets.map((rsc) => runGated(sem, () => syncOneKey(ctx, rsc))))).map((outcome, index) => {
		const target = targets[index];
		if (target === void 0) throw new Error(`internal: sync target at index ${index} is missing`);
		return toResultItem(outcome, target.key);
	});
};

//#endregion
//#region src/commands/sync.ts
const requireEntry$2 = (config, key) => {
	const entry = config.refs[key];
	if (entry === void 0) throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
	return entry;
};
const buildContext = (home, config, key) => ({
	home,
	key,
	ref: requireEntry$2(config, key),
	settings: config.settings
});
const NO_REQUESTED = 0;
/** No `refs` argument → every configured ref, sorted for deterministic output (mirrors `list.ts`);
* otherwise each argument is resolved via `matchRefKey` (full key or unique suffix) — an unmatched
* or ambiguous query throws immediately (fail fast), before any ref in the batch is touched. */
const resolveTargets = (home, config, requested) => {
	if (requested.length === NO_REQUESTED) return Object.keys(config.refs).toSorted().map((key) => buildContext(home, config, zRefKey.parse(key)));
	return requested.map((query) => buildContext(home, config, matchRefKey(config, query)));
};
/** `--stale-only` means "skip refs that need no work" — NOT merely "skip refs within their TTL".
* A ref whose checkout directory has been deleted needs a re-clone regardless of how recently it
* was last fetched, so a target is kept when it is EITHER stale-by-TTL (`ref-status.ts#isStale`,
* the exact same rule `list.ts` uses for its `[stale]` marker, so the two commands never disagree
* on what "stale" means) OR its checkout is missing (`isGitCheckout` false) — checked BEFORE any
* sync runs. */
const filterStale = (home, targets, state) => {
	const now = Date.now();
	return targets.filter((rsc) => {
		const ttlMs = durationToMs(resolveSetting("sync_ttl", rsc.ref, rsc.settings));
		const staleByTtl = isStale(state.refs[rsc.key]?.last_fetched_at, ttlMs, now);
		const checkoutMissing = !isGitCheckout(checkoutPath(home, rsc.key));
		return staleByTtl || checkoutMissing;
	});
};
/** Applies `--stale-only`'s filter, reading state only when it's actually needed. */
const scopeTargets = async (home, targets, staleOnly) => {
	if (!staleOnly) return targets;
	const state = await readState(home);
	return filterStale(home, targets, state);
};
const runSync = async (ctx, opts) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const targets = resolveTargets(home, config, opts.refs);
	const results = await syncAll(ctx, await scopeTargets(home, targets, opts.staleOnly));
	return {
		failedCount: results.filter((item) => item.status === "failed").length,
		results
	};
};
const STATUS_ORDER = [
	"updated",
	"fresh",
	"cloned",
	"restored",
	"failed"
];
const STATUS_LABEL = {
	cloned: "Cloned",
	failed: "Failed",
	fresh: "Fresh",
	restored: "Restored",
	updated: "Updated"
};
const SUMMARY_SEP = " / ";
const groupByStatus = (results) => {
	const groups = {
		cloned: [],
		failed: [],
		fresh: [],
		restored: [],
		updated: []
	};
	for (const item of results) groups[item.status].push(item);
	return groups;
};
const lineFor = (item) => {
	if (item.status === "failed") return `  ${item.key}: ${item.error ?? "unknown error"}`;
	if (item.warning !== void 0) return `  ${item.key} (${item.warning})`;
	return `  ${item.key}`;
};
/** `Updated (N) / Fresh (N) / Cloned (N) / Restored (N) / Failed (N)` summary line, followed by
* every non-empty group's keys (with the failure message for `Failed`, or the warning in
* parentheses when one fired) — printed even when every count is 0 (e.g. `--stale-only` filtered
* the whole batch away), rather than special-casing an empty result set. */
const syncHuman = (results) => {
	const groups = groupByStatus(results);
	const lines = [STATUS_ORDER.map((status) => `${STATUS_LABEL[status]} (${groups[status].length})`).join(SUMMARY_SEP)];
	for (const status of STATUS_ORDER) for (const item of groups[status]) lines.push(lineFor(item));
	return lines;
};
const buildSyncOptions = (refs, localOpts) => ({
	refs,
	staleOnly: localOpts.staleOnly === true
});
const registerSync = (program, ctx) => {
	program.command("sync").description("Fetch (or re-clone, if the checkout is missing) configured refs — all by default.").argument("[refs...]", "ref keys or unique suffixes to sync (default: every configured ref)").option("--stale-only", "skip refs whose last sync is still within their ref's sync_ttl").action((refs, localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const outcome = await runSync(ctx, buildSyncOptions(refs, localOpts));
			emit(ctx, opts, syncHuman(outcome.results), { results: outcome.results });
			if (outcome.failedCount > NO_REQUESTED) process.exitCode = EXIT.UNEXPECTED;
		})();
	});
};

//#endregion
//#region src/commands/tag.ts
const requireEntry$1 = (config, key) => {
	const entry = config.refs[key];
	if (entry === void 0) throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
	return entry;
};
/** Resolves the `tag_format` to render `version` against: the named package's own override when
* `packageName` is given and it has one, else the ref's own `tag_format` — the inheritance rule
* from spec §3. An unregistered `packageName` is a `notFoundError`, not a silent ref-level
* fallback. */
const formatFor = (entry, key, packageName) => {
	if (packageName === void 0) return entry.tag_format;
	const pkg = entry.packages?.[packageName];
	if (pkg === void 0) throw notFoundError(`no package '${packageName}' registered on ref '${key}'`);
	return pkg.tag_format ?? entry.tag_format;
};
/** Guards against a configured ref whose checkout directory is missing — first-class state
* elsewhere (`refs list` reports it, `refs sync` repairs it) that would otherwise surface here as
* a low-level git/cwd error out of `resolveTag`. */
const requireCheckout = (dest, key) => {
	if (!isGitCheckout(dest)) throw notFoundError(`checkout for '${key}' is missing — run: refs sync ${key}`);
};
const runTag = async (ctx, args) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const key = matchRefKey(config, args.query);
	const entry = requireEntry$1(config, key);
	const format = formatFor(entry, key, args.opts.packageName);
	const dest = checkoutPath(home, key);
	requireCheckout(dest, key);
	const tag = await resolveTag(ctx.runner, dest, format, args.version);
	return {
		key,
		ref_path: `refs/tags/${tag}`,
		tag,
		version: args.version
	};
};
const tagHuman = (data) => [`${data.key}@${data.version} -> ${data.tag}`];
const buildTagOptions = (localOpts) => {
	const opts = {};
	if (localOpts.package !== void 0) opts.packageName = localOpts.package;
	return opts;
};
const registerTag = (program, ctx) => {
	program.command("tag").description("Resolve a version to its git tag, via the ref's (or a package's) tag_format.").argument("<ref>", "full ref key or a unique suffix, e.g. next.js").argument("<version>", "version to resolve, e.g. 15.3.0").option("--package <name>", "resolve against this package's tag_format instead of the ref's").action((ref, version, localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const data = await runTag(ctx, {
				opts: buildTagOptions(localOpts),
				query: ref,
				version
			});
			emit(ctx, opts, tagHuman(data), data);
		})();
	});
};

//#endregion
//#region src/commands/registrars-more.ts
const MORE_REGISTRARS = [
	registerDoctor,
	registerMigrate,
	registerRemove,
	registerResolve,
	registerShow,
	registerSync,
	registerTag
];

//#endregion
//#region src/commands/add-packages.ts
const ROOT_PACKAGE_PATH = ".";
const NO_ITEMS = 0;
const toProposalEntry = (pkg) => {
	if (pkg.description === void 0) return { path: pkg.path };
	return {
		description: pkg.description,
		path: pkg.path
	};
};
/** Shapes the proposal's `packages` record: real workspace detection wins when it finds anything;
* otherwise, for an `npm:<pkg>` source, seeds a single entry for the package itself — at its
* packument-declared `directory` when known, else `path: '.'` (a single-package repo); a plain git
* url with no detected packages gets an empty record (→ no packages table at finalize time). */
const buildProposalPackages = (detected, npmDirectory, npmPkgName) => {
	if (detected.length > NO_ITEMS) return Object.fromEntries(detected.map((pkg) => [pkg.name, toProposalEntry(pkg)]));
	if (npmPkgName !== void 0) return { [npmPkgName]: { path: npmDirectory ?? ROOT_PACKAGE_PATH } };
	return {};
};
const toFinalPackageEntry = (pkg, fallbackDescription) => {
	const description = pkg.description ?? fallbackDescription;
	if (pkg.tag_format === void 0) return {
		description,
		path: pkg.path
	};
	return {
		description,
		path: pkg.path,
		tag_format: pkg.tag_format
	};
};
/** Only used by the `--description` one-shot flow: fills any package missing a detected
* description with the ref's own `--description` text, so the one-shot command never fails
* `zPackageEntry`'s non-empty-description requirement just because detection found a name/path but
* no description (see `workspaces.ts`'s deliberately-description-less fixture package). An empty
* `packages` record means a plain reference repo — omitted entirely (`undefined`), not `{}`. */
const buildFinalPackages = (proposalPackages, fallbackDescription) => {
	const entries = Object.entries(proposalPackages);
	if (entries.length === NO_ITEMS) return;
	return Object.fromEntries(entries.map(([name, pkg]) => [name, toFinalPackageEntry(pkg, fallbackDescription)]));
};
/** The `--proposal <file>` flow's packages already went through human review as full
* `zPackageEntry`s (`zFinalProposal` guarantees non-empty descriptions) — only the empty→undefined
* "no packages table" collapse is still needed here. */
const finalProposalPackages = (packages) => {
	if (Object.keys(packages).length === NO_ITEMS) return;
	return packages;
};
/** A `null` `tag_format_candidate` means dry-run detection found no reliable tag format — finalize
* (either `--proposal` or `--description`) needs a real one to satisfy `zRefEntry.tag_format`
* (required, unlike the proposal's nullable candidate): either the human filled it in in the
* proposal file, or the source repo really has none and finalizing must be rejected. */
const requireTagFormat = (candidate) => {
	if (candidate === null) throw validationError("tag_format_candidate must be set to a valid tag format (containing '{version}') before finalizing — edit the proposal and provide one, or add the ref manually");
	return candidate;
};
const buildRefEntry = (ref) => {
	if (ref.packages === void 0) return {
		default_branch: ref.default_branch,
		description: ref.description,
		tag_format: ref.tag_format,
		url: ref.url
	};
	return {
		default_branch: ref.default_branch,
		description: ref.description,
		packages: ref.packages,
		tag_format: ref.tag_format,
		url: ref.url
	};
};

//#endregion
//#region src/commands/add-dry-run.ts
const NO_WARNINGS$2 = [];
/** Normalizes an optional warning string into the envelope's `warnings` array shape. */
const toWarningsList = (warning) => {
	if (warning === void 0) return [...NO_WARNINGS$2];
	return [warning];
};
const detectProposalFields = async (runner, dest, resolved) => {
	const defaultBranch = await detectDefaultBranch(runner, dest);
	const tagFormatCandidate = detectTagFormat(await listTags(runner, dest));
	return {
		defaultBranch,
		packages: buildProposalPackages(await detectWorkspacePackages(dest), resolved.npmDirectory, resolved.npmPkgName),
		tagFormatCandidate
	};
};
const cloneAndDetect = (ctx, opts) => withLock(opts.home, refLockName(opts.resolved.key), async () => {
	const cloneOutcome = await ensureClonedCheckout(ctx.runner, {
		allowFileUrls: allowFileUrlsFrom(ctx.env),
		cloneUrl: opts.resolved.cloneUrl,
		dest: opts.dest,
		home: opts.home,
		hooksDir: opts.home.hooksDir,
		mode: opts.cloneMode
	});
	const result = { fields: await detectProposalFields(ctx.runner, opts.dest, opts.resolved) };
	if (cloneOutcome.effectiveMode !== void 0) result.effectiveMode = cloneOutcome.effectiveMode;
	if (cloneOutcome.warning !== void 0) result.warning = cloneOutcome.warning;
	return result;
});
const buildDryRunOutcome = (opts) => {
	const proposal = {
		default_branch: opts.cloneResult.fields.defaultBranch,
		description: "",
		key: opts.resolved.key,
		packages: opts.cloneResult.fields.packages,
		tag_format_candidate: opts.cloneResult.fields.tagFormatCandidate,
		url: opts.resolved.cloneUrl
	};
	const outcome = {
		dest: opts.dest,
		proposal
	};
	if (opts.cloneResult.effectiveMode !== void 0) outcome.effectiveCloneMode = opts.cloneResult.effectiveMode;
	if (opts.cloneResult.warning !== void 0) outcome.warning = opts.cloneResult.warning;
	return outcome;
};
const runDryRunCore = async (ctx, source) => {
	const home = resolveHome(ctx.env);
	const config = await readConfig(home);
	const resolved = applyConfiguredTransport(await resolveAddSource(ctx, source), config.settings);
	ensureNoConflict(config, resolved.key);
	await ensureNoCaseCollision(home, resolved.key);
	const dest = checkoutPath(home, resolved.key);
	const cloneMode = resolveSetting("clone_mode", void 0, config.settings);
	const cloneResult = await cloneAndDetect(ctx, {
		cloneMode,
		dest,
		home,
		resolved
	});
	return buildDryRunOutcome({
		cloneResult,
		dest,
		resolved
	});
};
/** Records that a dry-run proposal is pending for `key` — cleared again once `--proposal`/
* `--description` finalizes it (see `finalizeRef` in `add.ts`). Also persists `effectiveCloneMode`
* when this dry-run actually cloned (see `ensureClonedCheckout`'s partial-clone-fallback note) so a
* later `--proposal` finalize — which never re-clones — can recover the real mode used instead of
* silently guessing the global default.
*
* Re-checks the conflict guard again here, under the home lock: `runDryRunCore`'s own
* `ensureNoConflict` call ran unlocked, earlier — a `--proposal`/`--description` finalize could
* race in between and configure `key` before this lock is acquired, which would otherwise re-add
* `pending_proposal_at` onto an already-configured ref. */
const writePendingProposal = (home, key, effectiveCloneMode) => withLock(home, "home", async () => {
	ensureNoConflict(await readConfig(home), key);
	const state = await readState(home);
	const previous = state.refs[key];
	const resolvedMode = effectiveCloneMode ?? previous?.effective_clone_mode;
	const nextState = {
		...previous,
		pending_proposal_at: (/* @__PURE__ */ new Date()).toISOString()
	};
	if (resolvedMode !== void 0) nextState.effective_clone_mode = resolvedMode;
	state.refs[key] = nextState;
	await writeState(home, state);
});

//#endregion
//#region src/commands/add-finalize.ts
const parseFinalDocsOrThrow = (config, state) => {
	const configResult = zConfig.safeParse(config);
	if (!configResult.success) throw validationError(prettifyError(configResult.error));
	const stateResult = zState.safeParse(state);
	if (!stateResult.success) throw validationError(prettifyError(stateResult.error));
	return {
		config: configResult.data,
		state: stateResult.data
	};
};
const buildValidatedFinalDocs = async (opts, headSha) => {
	const config = await readConfig(opts.home);
	ensureNoConflict(config, opts.ref.key);
	const entry = buildRefEntry(opts.ref);
	config.refs[opts.ref.key] = entry;
	const state = await readState(opts.home);
	state.refs[opts.ref.key] = {
		effective_clone_mode: opts.effectiveCloneMode ?? state.refs[opts.ref.key]?.effective_clone_mode ?? resolveSetting("clone_mode", void 0, config.settings),
		head_sha: headSha,
		last_fetched_at: (/* @__PURE__ */ new Date()).toISOString()
	};
	return {
		...parseFinalDocsOrThrow(config, state),
		entry
	};
};
const finalizeRef = async (ctx, opts) => {
	const allowFileUrls = allowFileUrlsFrom(ctx.env);
	const headSha = await withLock(opts.home, refLockName(opts.ref.key), () => {
		assertInsideSources(opts.home, opts.dest);
		return resolveCheckoutHead(ctx.runner, {
			allowFileUrls,
			dest: opts.dest,
			expectedUrl: opts.ref.url,
			hooksDir: opts.home.hooksDir,
			key: opts.ref.key
		});
	});
	return withLock(opts.home, "home", async () => {
		const { config, entry, state } = await buildValidatedFinalDocs(opts, headSha);
		await writeState(opts.home, state);
		await writeConfig(opts.home, config);
		return {
			entry,
			key: opts.ref.key
		};
	});
};

//#endregion
//#region src/commands/add-proposal-io.ts
const STDIN_MARKER = "-";
/** Reads the proposal JSON's raw text: `-` reads stdin (via `ctx.readStdin`), anything else is a
* file path. Kept separate from parsing so a file-not-found error surfaces with its own
* `ENOENT`-flavoured message rather than being folded into "invalid JSON". */
const readProposalText = (ctx, location) => {
	if (location === STDIN_MARKER) return ctx.readStdin();
	return readFile(location, "utf8");
};
const errorDetail = (error) => {
	if (error instanceof Error) return error.message;
	return String(error);
};
const parseProposalJson = (text) => {
	try {
		return JSON.parse(text);
	} catch (error) {
		throw validationError(`invalid JSON in proposal: ${errorDetail(error)}`);
	}
};
/** Validates the parsed JSON against `zFinalProposal`, rendering a zod "pretty" error on failure —
* the two-phase contract's whole point is that a human (or agent) may have hand-edited this file,
* so validation failures need to be legible, not a raw zod issue dump. */
const parseFinalProposal = (raw) => {
	const parsed = zFinalProposal.safeParse(raw);
	if (!parsed.success) throw validationError(prettifyError(parsed.error));
	return parsed.data;
};
/** Reads `location` (a file path, or `-` for stdin) and parses+validates it as a `FinalProposal`. */
const loadFinalProposal = async (ctx, location) => {
	const text = await readProposalText(ctx, location);
	return parseFinalProposal(parseProposalJson(text));
};

//#endregion
//#region src/commands/add.ts
const NO_ACTIVE_MODES = 0;
const MIN_ACTIVE_MODES = 1;
const dryRunHuman = (key, dest) => [`refs add: dry-run proposal ready for '${key}' (checkout: ${dest})`, "next: review the proposal, then run refs add --proposal <file> to finalize"];
const runAddDryRun = async (ctx, source) => {
	const outcome = await runDryRunCore(ctx, source);
	await writePendingProposal(resolveHome(ctx.env), outcome.proposal.key, outcome.effectiveCloneMode);
	const warnings = toWarningsList(outcome.warning);
	return {
		data: outcome.proposal,
		human: dryRunHuman(outcome.proposal.key, outcome.dest),
		warnings
	};
};
const finalizeHuman = (key) => [`refs add: '${key}' added to config`];
const buildProposalRef = (finalProposal) => {
	const ref = {
		default_branch: finalProposal.default_branch,
		description: finalProposal.description,
		key: finalProposal.key,
		tag_format: requireTagFormat(finalProposal.tag_format_candidate),
		url: finalProposal.url
	};
	const packages = finalProposalPackages(finalProposal.packages);
	if (packages !== void 0) ref.packages = packages;
	return ref;
};
const runAddProposal = async (ctx, location) => {
	const finalProposal = await loadFinalProposal(ctx, location);
	const home = resolveHome(ctx.env);
	const dest = checkoutPath(home, finalProposal.key);
	if (!isGitCheckout(dest)) throw notFoundError(`no checkout found at ${dest} — run: refs add <source> --dry-run first`);
	const { entry, key } = await finalizeRef(ctx, {
		dest,
		home,
		ref: buildProposalRef(finalProposal)
	});
	return {
		data: {
			entry,
			key
		},
		human: finalizeHuman(key),
		warnings: []
	};
};
const buildDescriptionRef = (outcome, description) => {
	const ref = {
		default_branch: outcome.proposal.default_branch,
		description,
		key: outcome.proposal.key,
		tag_format: requireTagFormat(outcome.proposal.tag_format_candidate),
		url: outcome.proposal.url
	};
	const packages = buildFinalPackages(outcome.proposal.packages, description);
	if (packages !== void 0) ref.packages = packages;
	return ref;
};
const runAddDescription = async (ctx, source, description) => {
	const outcome = await runDryRunCore(ctx, source);
	const home = resolveHome(ctx.env);
	const ref = buildDescriptionRef(outcome, description);
	const finalizeOpts = {
		dest: outcome.dest,
		home,
		ref
	};
	if (outcome.effectiveCloneMode !== void 0) finalizeOpts.effectiveCloneMode = outcome.effectiveCloneMode;
	const { entry, key } = await finalizeRef(ctx, finalizeOpts);
	const warnings = toWarningsList(outcome.warning);
	return {
		data: {
			entry,
			key
		},
		human: finalizeHuman(key),
		warnings
	};
};
const NEEDS_MODE_MESSAGE = "refs add needs --dry-run, --proposal, or --description";
const MUTUALLY_EXCLUSIVE_MESSAGE = "refs add: use only one of --dry-run, --proposal, or --description";
const REQUIRES_SOURCE_MESSAGE = "refs add requires <source> (a git url or npm:<package>)";
const assertSingleMode = (opts) => {
	const activeCount = [
		opts.dryRun,
		opts.proposal !== void 0,
		opts.description !== void 0
	].filter(Boolean).length;
	if (activeCount > MIN_ACTIVE_MODES) throw usageError(MUTUALLY_EXCLUSIVE_MESSAGE);
	if (activeCount === NO_ACTIVE_MODES) throw usageError(NEEDS_MODE_MESSAGE);
};
const requireSource = (source) => {
	if (source === void 0 || source === "") throw usageError(REQUIRES_SOURCE_MESSAGE);
	return source;
};
const runAdd = (ctx, opts) => {
	assertSingleMode(opts);
	if (opts.proposal !== void 0) return runAddProposal(ctx, opts.proposal);
	if (opts.description !== void 0) return runAddDescription(ctx, requireSource(opts.source), opts.description);
	return runAddDryRun(ctx, requireSource(opts.source));
};
const buildAddOptions = (source, localOpts) => {
	const opts = { dryRun: localOpts.dryRun === true };
	if (source !== void 0) opts.source = source;
	if (localOpts.proposal !== void 0) opts.proposal = localOpts.proposal;
	if (localOpts.description !== void 0) opts.description = localOpts.description;
	return opts;
};
const registerAdd = (program, ctx) => {
	program.command("add").description("Add a git reference in two phases: propose (--dry-run), then finalize (--proposal).").argument("[source]", "git url or npm:<package> (omit when finalizing with --proposal)").option("--dry-run", "resolve and clone the source, writing a reviewable proposal").option("--proposal <file>", "finalize from a completed proposal JSON file (- for stdin)").option("--description <text>", "one-shot: dry-run then finalize immediately with this description").action((source, localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const outcome = await runAdd(ctx, buildAddOptions(source, localOpts));
			emit(ctx, opts, outcome.human, outcome.data, outcome.warnings);
		})();
	});
};

//#endregion
//#region src/commands/edit-envelope.ts
const normalizeEditValue = (value) => {
	if (value === void 0) return null;
	return value;
};

//#endregion
//#region src/commands/edit-package.ts
const packageFieldNames = () => Object.keys(zPackageEntry.shape).toSorted().join(", ");
const unknownPackageFieldMessage = (field) => `unknown package field '${field}' — valid fields: ${packageFieldNames()}`;
const isPackageField = (field) => Object.hasOwn(zPackageEntry.shape, field);
/** An unregistered `packageName` is a `notFoundError`, mirroring `tag.ts`'s `formatFor` — an
* `--package` naming a package that was never added to the ref is a lookup failure, not a usage
* mistake. */
const requirePackage = (entry, key, packageName) => {
	const pkg = entry.packages?.[packageName];
	if (pkg === void 0) throw notFoundError(`no package '${packageName}' registered on ref '${key}'`);
	return pkg;
};
/** Pure (sync) core of the edit: validates `field` against `zPackageEntry`'s own shape, then
* re-validates the WHOLE package entry (not just the touched field) — mirrors
* `edit-settings.ts`'s `runEditSettings`. Split out of `editPackageField` purely to keep that
* function's statement count under the repo's oxlint cap. */
const applyPackageFieldEdit = (pkg, field, value) => {
	if (!isPackageField(field)) throw usageError(unknownPackageFieldMessage(field));
	const oldValue = pkg[field];
	const parsed = zPackageEntry.safeParse({
		...pkg,
		[field]: value
	});
	if (!parsed.success) throw validationError(prettifyError(parsed.error));
	return {
		field,
		newValue: parsed.data[field],
		oldValue,
		updated: parsed.data
	};
};
/** Mutates one field of `args.packageName`'s package entry (via `applyPackageFieldEdit`) and
* writes the whole config back. An unrecognized `field` is a `usageError` listing every valid
* package field; an unregistered `packageName` is a `notFoundError` (see `requirePackage`). */
const editPackageField = async (args) => {
	const pkg = requirePackage(args.entry, args.key, args.packageName);
	const result = applyPackageFieldEdit(pkg, args.field, args.value);
	const updatedEntry = {
		...args.entry,
		packages: {
			...args.entry.packages,
			[args.packageName]: result.updated
		}
	};
	await writeConfig(args.home, {
		...args.config,
		refs: {
			...args.config.refs,
			[args.key]: updatedEntry
		}
	});
	return {
		field: result.field,
		key: args.key,
		new: normalizeEditValue(result.newValue),
		old: normalizeEditValue(result.oldValue)
	};
};

//#endregion
//#region src/commands/edit-ref.ts
const PACKAGES_FIELD = "packages";
const URL_FIELD = "url";
const SUCCESS_EXIT_CODE = 0;
const PACKAGES_USAGE_MESSAGE = "use --package <name> <field> <value>";
const DIFFERENT_KEY_MESSAGE = "new url derives a different key — remove and re-add instead";
const requireEntry = (config, key) => {
	const entry = config.refs[key];
	if (entry === void 0) throw new Error(`internal: matched ref key '${key}' is missing from config.refs`);
	return entry;
};
const refFieldNames = () => Object.keys(zRefEntry.shape).filter((name) => name !== PACKAGES_FIELD).toSorted().join(", ");
const unknownFieldMessage = (field) => `unknown ref field '${field}' — valid fields: ${refFieldNames()}`;
const isRefField = (field) => Object.hasOwn(zRefEntry.shape, field);
const remoteRewriteFailedMessage = (dest, cloneUrl, stderr) => `failed to rewrite git remote at ${dest} to '${cloneUrl}': ${stderr.trim()}`;
/** Rewrites `dest`'s `origin` remote to `cloneUrl` via `git remote set-url origin <url>` — but
* only when `dest` is actually a checkout (an added-but-never-synced ref, or one whose checkout
* was removed, has nothing to rewrite). `dest` is containment-checked (`assertInsideSources`)
* FIRST, before even the `isGitCheckout` probe: `git remote set-url` writes `.git/config`, so a
* symlinked ancestor under sources/ would otherwise get an OUTSIDE repo's origin rewritten — and
* the caller would then persist the new url to config on top of it. A checkout-less dest still
* passes the guard (its non-existing suffix resolves inside sources/), keeping the
* added-but-never-synced edit path working. A failed rewrite (e.g. no `origin` remote configured)
* surfaces as a `validationError` rather than silently leaving config and checkout out of sync. */
const rewriteRemoteIfCheckedOut = async (ctx, opts) => {
	assertInsideSources(opts.home, opts.dest);
	if (!isGitCheckout(opts.dest)) return;
	const result = await ctx.runner.run("git", [
		"remote",
		"set-url",
		"origin",
		opts.cloneUrl
	], { cwd: opts.dest });
	if (result.exitCode !== SUCCESS_EXIT_CODE) throw validationError(remoteRewriteFailedMessage(opts.dest, opts.cloneUrl, result.stderr));
};
const editUrlField = async (ctx, args) => {
	const canonical = canonicalizeGitUrl(args.value, { allowFileUrls: allowFileUrlsFrom(ctx.env) });
	if (canonical.key !== args.key) throw validationError(DIFFERENT_KEY_MESSAGE);
	const dest = checkoutPath(args.home, args.key);
	await rewriteRemoteIfCheckedOut(ctx, {
		cloneUrl: canonical.cloneUrl,
		dest,
		home: args.home
	});
	return {
		...args.entry,
		url: canonical.cloneUrl
	};
};
const editPlainRefField = (entry, field, value) => {
	const candidate = {
		...entry,
		[field]: value
	};
	const parsed = zRefEntry.safeParse(candidate);
	if (!parsed.success) throw validationError(prettifyError(parsed.error));
	return parsed.data;
};
/** `url` needs its own (async, checkout-touching) path; every other recognized field is a plain
* re-validated assignment (`editPlainRefField`). Written as two early-return branches rather than
* a ternary — this repo's oxlint config forbids `no-ternary`. */
const resolveUpdatedEntry = (ctx, args) => {
	if (args.field === URL_FIELD) return editUrlField(ctx, {
		entry: args.entry,
		home: args.home,
		key: args.key,
		value: args.value
	});
	return Promise.resolve(editPlainRefField(args.entry, args.field, args.value));
};
const editTopLevelField = async (ctx, args) => {
	const { field } = args;
	if (field === PACKAGES_FIELD) throw usageError(PACKAGES_USAGE_MESSAGE);
	if (!isRefField(field)) throw usageError(unknownFieldMessage(field));
	const old = args.entry[field];
	const updated = await resolveUpdatedEntry(ctx, {
		entry: args.entry,
		field,
		home: args.home,
		key: args.key,
		value: args.value
	});
	return {
		new: updated[field],
		old,
		updated
	};
};
const runEditRef = (ctx, args) => {
	const home = resolveHome(ctx.env);
	const { field, opts, query, value } = args;
	return withLock(home, "home", async () => {
		const config = await readConfig(home);
		const key = matchRefKey(config, query);
		const entry = requireEntry(config, key);
		if (opts.packageName !== void 0) return editPackageField({
			config,
			entry,
			field,
			home,
			key,
			packageName: opts.packageName,
			value
		});
		const result = await editTopLevelField(ctx, {
			entry,
			field,
			home,
			key,
			value
		});
		await writeConfig(home, {
			...config,
			refs: {
				...config.refs,
				[key]: result.updated
			}
		});
		return {
			field,
			key,
			new: normalizeEditValue(result.new),
			old: normalizeEditValue(result.old)
		};
	});
};

//#endregion
//#region src/commands/edit-settings.ts
const SETTINGS_MODE_KEY = "settings";
const NO_WARNINGS$1 = [];
const settingsKeyNames = () => Object.keys(zSettings.shape).toSorted().join(", ");
const unknownSettingMessage = (key) => `unknown setting '${key}' — valid settings: ${settingsKeyNames()}`;
const isSettingsKey = (key) => Object.hasOwn(zSettings.shape, key);
const collisionNote = (detail) => `note: 'settings' addressed the global settings, not ${detail} — use the full ref key to edit that ref`;
const AMBIGUOUS_COLLISION_DETAIL = "one of several matching refs — see `refs list`";
/** Detects `edit.ts`'s documented silent-collision case: a configured ref reachable by the bare
* suffix `'settings'` (e.g. `github.com/acme/settings`) can never itself be reached through
* `refs edit settings ...`, because that reserved word always dispatches to global settings first.
* Reuses `matchRefKey` purely as a probe — a `usageError` it throws for an ambiguous suffix (more
* than one ref ending in `/settings`) still means "some ref matches", just not uniquely, so that
* counts too; a `notFoundError` means no ref collides at all and no warning is warranted. */
const collisionWarnings = (config) => {
	try {
		const key = matchRefKey(config, SETTINGS_MODE_KEY);
		return [collisionNote(`ref '${key}'`)];
	} catch (error) {
		if (error instanceof RefsError && error.code === "usage") return [collisionNote(AMBIGUOUS_COLLISION_DETAIL)];
		if (error instanceof RefsError && error.code === "not_found") return NO_WARNINGS$1;
		throw error;
	}
};
/** Builds the final `{data, warnings}` result once the write has already gone through — split out
* of `runEditSettings` purely to keep that function's statement count under the repo's
* `max-statements` oxlint cap, mirroring `edit-package.ts`'s `applyPackageFieldEdit` split. */
const buildEditSettingsResult = (outcome) => {
	return {
		data: {
			field: outcome.key,
			key: SETTINGS_MODE_KEY,
			new: normalizeEditValue(outcome.parsed[outcome.key]),
			old: normalizeEditValue(outcome.old)
		},
		warnings: collisionWarnings(outcome.config)
	};
};
/** Mutates one global setting under the home lock: rejects an unrecognized `key` with a
* `usageError` listing every valid setting, and rejects a value that fails `zSettings`
* (re-validated as a whole, not just the touched field) with a `validationError` carrying zod's
* prettified message. Only ever writes the config once every check has passed. Also surfaces
* `collisionWarnings` in the returned envelope — settings mode always wins the reserved-word
* dispatch, but a ref addressable by the same suffix should never be silently shadowed. */
const runEditSettings = (ctx, args) => {
	const home = resolveHome(ctx.env);
	return withLock(home, "home", async () => {
		const config = await readConfig(home);
		if (!isSettingsKey(args.key)) throw usageError(unknownSettingMessage(args.key));
		const old = config.settings[args.key];
		const candidate = {
			...config.settings,
			[args.key]: args.value
		};
		const parsed = zSettings.safeParse(candidate);
		if (!parsed.success) throw validationError(prettifyError(parsed.error));
		await writeConfig(home, {
			...config,
			settings: parsed.data
		});
		return buildEditSettingsResult({
			config,
			key: args.key,
			old,
			parsed: parsed.data
		});
	});
};

//#endregion
//#region src/commands/edit.ts
const SETTINGS_MODE_KEYWORD = "settings";
const NO_WARNINGS = [];
const PACKAGE_OPTION_USAGE_MESSAGE = "--package is not valid with 'refs edit settings ...' — it only applies to ref/package edits";
const buildEditOptions = (localOpts) => {
	const opts = {};
	if (localOpts.package !== void 0) opts.packageName = localOpts.package;
	return opts;
};
const runEdit = async (ctx, args) => {
	if (args.first === SETTINGS_MODE_KEYWORD) {
		if (args.opts.packageName !== void 0) throw usageError(PACKAGE_OPTION_USAGE_MESSAGE);
		return runEditSettings(ctx, {
			key: args.second,
			value: args.value
		});
	}
	return {
		data: await runEditRef(ctx, {
			field: args.second,
			opts: args.opts,
			query: args.first,
			value: args.value
		}),
		warnings: NO_WARNINGS
	};
};
const UNSET_DISPLAY = "(unset)";
const formatEditValue = (value) => {
	if (value === null || value === void 0) return UNSET_DISPLAY;
	return String(value);
};
const editHuman = (data) => [`${data.key}: ${data.field} '${formatEditValue(data.old)}' -> '${formatEditValue(data.new)}'`];
const registerEdit = (program, ctx) => {
	program.command("edit").description("Edit one field: 'refs edit settings <key> <value>' for a global setting, or 'refs edit <ref> <field> <value> [--package <name>]' for a ref or package field.").argument("<ref-or-settings>", "a ref key/unique suffix, or the literal 'settings'").argument("<field-or-key>", "field to edit (or, in settings mode, the setting key)").argument("<value>", "the new value").option("--package <name>", "edit this package's field instead of a top-level ref field").action((first, second, value, localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const { data, warnings } = await runEdit(ctx, {
				first,
				opts: buildEditOptions(localOpts),
				second,
				value
			});
			emit(ctx, opts, editHuman(data), data, warnings);
		})();
	});
};

//#endregion
//#region src/commands/init.ts
const SKILL_HINT = "Install the agent skill: npx skills add kaisers-io/refs   (private phase: npx skills add <path-to-this-repo> --skill refs)";
const ensureHomeDirs = async (home) => {
	await mkdir(home.root, { recursive: true });
	await mkdir(home.sourcesDir, { recursive: true });
	await mkdir(home.locksDir, { recursive: true });
	await mkdir(home.hooksDir, { recursive: true });
};
const runInit = async (ctx) => {
	const home = resolveHome(ctx.env);
	await ensureHomeDirs(home);
	return {
		config: await withLock(home, "home", async () => {
			const result = await migrateConfig(home, version);
			await installHooksGuard(home);
			return result;
		}),
		home: home.root,
		skill_hint: SKILL_HINT
	};
};
const registerInit = (program, ctx) => {
	program.command("init").description("Seed or migrate the refs home directory, its config, and the git hooks guard.").action((_localOpts, command) => {
		const globals = command.optsWithGlobals();
		const opts = {
			json: globals.json === true,
			verbose: globals.verbose === true
		};
		return wrapAction(ctx, opts, async () => {
			const data = await runInit(ctx);
			emit(ctx, opts, [`refs home: ${data.home} (${data.config})`, SKILL_HINT], data);
		})();
	});
};

//#endregion
//#region src/commands/registry.ts
const REGISTRARS = [
	registerInit,
	registerAdd,
	registerEdit,
	registerList,
	...MORE_REGISTRARS
];
const registerCommands = (program, ctx) => {
	for (const register of REGISTRARS) register(program, ctx);
};

//#endregion
//#region src/main.ts
const HELP_TEXT_AFTER = [
	"",
	"Examples:",
	"  $ refs list --json",
	"  $ refs sync --stale-only --json",
	"  $ refs resolve next/navigation --json",
	"",
	"Every command accepts --json for structured output and --verbose for stack traces on error."
].join("\n");
const SUCCESSFUL_EXIT_CODES = /* @__PURE__ */ new Set([
	"commander.help",
	"commander.helpDisplayed",
	"commander.version"
]);
const JSON_FLAG = "--json";
const VERBOSE_FLAG = "--verbose";
const ARGV_TERMINATOR = "--";
const TRAILING_NEWLINE_PATTERN = /\n$/u;
const ERROR_PREFIX_PATTERN = /^error: /u;
const stripCommanderPrefix = (message) => message.replace(ERROR_PREFIX_PATTERN, "");
const hasGlobalFlag = (argv, flag) => {
	for (const token of argv) {
		if (token === ARGV_TERMINATOR) return false;
		if (token === flag) return true;
	}
	return false;
};
const isJsonMode = (argv) => hasGlobalFlag(argv, JSON_FLAG);
const isVerboseMode = (argv) => hasGlobalFlag(argv, VERBOSE_FLAG);
const appendStackWhenVerbose = (message, stack, verbose) => {
	if (verbose && stack !== void 0) return `${message}\n${stack}`;
	return message;
};
const buildProgram = (ctx) => {
	const program = new Command().name("refs").description("Manage git-based reference checkouts shared across a workspace.").version(version).option(JSON_FLAG, "emit machine-readable JSON on stdout instead of human-readable text").option(VERBOSE_FLAG, "include stack traces in error output").allowExcessArguments(false).exitOverride().configureOutput({
		outputError: () => {},
		writeErr: (str) => {
			ctx.errLine(str.replace(TRAILING_NEWLINE_PATTERN, ""));
		},
		writeOut: (str) => {
			ctx.out(str.replace(TRAILING_NEWLINE_PATTERN, ""));
		}
	});
	program.addHelpText("after", HELP_TEXT_AFTER);
	registerCommands(program, ctx);
	return program;
};
const finishSuccessfulExit = () => {
	process.exitCode = EXIT.OK;
};
const emitCommanderFailure = (ctx, opts, error) => {
	emitError(ctx, opts, {
		code: "usage",
		message: appendStackWhenVerbose(stripCommanderPrefix(error.message), error.stack, opts.verbose)
	});
	process.exitCode = EXIT.USAGE;
};
const handleCommanderError = (ctx, opts, error) => {
	if (SUCCESSFUL_EXIT_CODES.has(error.code)) {
		finishSuccessfulExit();
		return;
	}
	emitCommanderFailure(ctx, opts, error);
};
const handleUnexpectedError = (ctx, opts, error) => {
	const rendered = renderError(error, { verbose: opts.verbose });
	emitError(ctx, opts, rendered);
	process.exitCode = rendered.exitCode;
};
const runProgram = async (ctx, program, argv) => {
	const opts = {
		json: isJsonMode(argv),
		verbose: isVerboseMode(argv)
	};
	try {
		await program.parseAsync(argv);
	} catch (error) {
		if (error instanceof CommanderError) {
			handleCommanderError(ctx, opts, error);
			return;
		}
		handleUnexpectedError(ctx, opts, error);
	}
};
const run = (ctx, argv) => runProgram(ctx, buildProgram(ctx), argv);

//#endregion
//#region src/index.ts
if (import.meta.main) await run(realContext(), process.argv);

//#endregion
export { buildProgram, emit, emitError, realContext, registerCommands, run, runProgram, wrapAction };