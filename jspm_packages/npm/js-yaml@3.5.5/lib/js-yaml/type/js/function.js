/* */ 
'use strict';
var esprima;
try {
  var _require = require;
  esprima = _require('esprima');
} catch (_) {
  if (typeof window !== 'undefined')
    esprima = window.esprima;
}
var Type = require('../../type');
function resolveJavascriptFunction(data) {
  if (data === null)
    return false;
  try {
    var source = '(' + data + ')',
        ast = esprima.parse(source, {range: true});
    if (ast.type !== 'Program' || ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement' || ast.body[0].expression.type !== 'FunctionExpression') {
      return false;
    }
    return true;
  } catch (err) {
    return false;
  }
}
function constructJavascriptFunction(data) {
  var source = '(' + data + ')',
      ast = esprima.parse(source, {range: true}),
      params = [],
      body;
  if (ast.type !== 'Program' || ast.body.length !== 1 || ast.body[0].type !== 'ExpressionStatement' || ast.body[0].expression.type !== 'FunctionExpression') {
    throw new Error('Failed to resolve function');
  }
  ast.body[0].expression.params.forEach(function(param) {
    params.push(param.name);
  });
  body = ast.body[0].expression.body.range;
  return new Function(params, source.slice(body[0] + 1, body[1] - 1));
}
function representJavascriptFunction(object) {
  return object.toString();
}
function isFunction(object) {
  return Object.prototype.toString.call(object) === '[object Function]';
}
module.exports = new Type('tag:yaml.org,2002:js/function', {
  kind: 'scalar',
  resolve: resolveJavascriptFunction,
  construct: constructJavascriptFunction,
  predicate: isFunction,
  represent: representJavascriptFunction
});
