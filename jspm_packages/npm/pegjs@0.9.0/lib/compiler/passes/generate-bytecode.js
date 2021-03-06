/* */ 
(function(process) {
  "use strict";
  var arrays = require('../../utils/arrays'),
      objects = require('../../utils/objects'),
      asts = require('../asts'),
      visitor = require('../visitor'),
      op = require('../opcodes'),
      js = require('../javascript');
  function generateBytecode(ast) {
    var consts = [];
    function addConst(value) {
      var index = arrays.indexOf(consts, value);
      return index === -1 ? consts.push(value) - 1 : index;
    }
    function addFunctionConst(params, code) {
      return addConst("function(" + params.join(", ") + ") {" + code + "}");
    }
    function buildSequence() {
      return Array.prototype.concat.apply([], arguments);
    }
    function buildCondition(condCode, thenCode, elseCode) {
      return condCode.concat([thenCode.length, elseCode.length], thenCode, elseCode);
    }
    function buildLoop(condCode, bodyCode) {
      return condCode.concat([bodyCode.length], bodyCode);
    }
    function buildCall(functionIndex, delta, env, sp) {
      var params = arrays.map(objects.values(env), function(p) {
        return sp - p;
      });
      return [op.CALL, functionIndex, delta, params.length].concat(params);
    }
    function buildSimplePredicate(expression, negative, context) {
      return buildSequence([op.PUSH_CURR_POS], [op.SILENT_FAILS_ON], generate(expression, {
        sp: context.sp + 1,
        env: objects.clone(context.env),
        action: null
      }), [op.SILENT_FAILS_OFF], buildCondition([negative ? op.IF_ERROR : op.IF_NOT_ERROR], buildSequence([op.POP], [negative ? op.POP : op.POP_CURR_POS], [op.PUSH_UNDEFINED]), buildSequence([op.POP], [negative ? op.POP_CURR_POS : op.POP], [op.PUSH_FAILED])));
    }
    function buildSemanticPredicate(code, negative, context) {
      var functionIndex = addFunctionConst(objects.keys(context.env), code);
      return buildSequence([op.UPDATE_SAVED_POS], buildCall(functionIndex, 0, context.env, context.sp), buildCondition([op.IF], buildSequence([op.POP], negative ? [op.PUSH_FAILED] : [op.PUSH_UNDEFINED]), buildSequence([op.POP], negative ? [op.PUSH_UNDEFINED] : [op.PUSH_FAILED])));
    }
    function buildAppendLoop(expressionCode) {
      return buildLoop([op.WHILE_NOT_ERROR], buildSequence([op.APPEND], expressionCode));
    }
    var generate = visitor.build({
      grammar: function(node) {
        arrays.each(node.rules, generate);
        node.consts = consts;
      },
      rule: function(node) {
        node.bytecode = generate(node.expression, {
          sp: -1,
          env: {},
          action: null
        });
      },
      named: function(node, context) {
        var nameIndex = addConst('{ type: "other", description: "' + js.stringEscape(node.name) + '" }');
        return buildSequence([op.SILENT_FAILS_ON], generate(node.expression, context), [op.SILENT_FAILS_OFF], buildCondition([op.IF_ERROR], [op.FAIL, nameIndex], []));
      },
      choice: function(node, context) {
        function buildAlternativesCode(alternatives, context) {
          return buildSequence(generate(alternatives[0], {
            sp: context.sp,
            env: objects.clone(context.env),
            action: null
          }), alternatives.length > 1 ? buildCondition([op.IF_ERROR], buildSequence([op.POP], buildAlternativesCode(alternatives.slice(1), context)), []) : []);
        }
        return buildAlternativesCode(node.alternatives, context);
      },
      action: function(node, context) {
        var env = objects.clone(context.env),
            emitCall = node.expression.type !== "sequence" || node.expression.elements.length === 0,
            expressionCode = generate(node.expression, {
              sp: context.sp + (emitCall ? 1 : 0),
              env: env,
              action: node
            }),
            functionIndex = addFunctionConst(objects.keys(env), node.code);
        return emitCall ? buildSequence([op.PUSH_CURR_POS], expressionCode, buildCondition([op.IF_NOT_ERROR], buildSequence([op.LOAD_SAVED_POS, 1], buildCall(functionIndex, 1, env, context.sp + 2)), []), [op.NIP]) : expressionCode;
      },
      sequence: function(node, context) {
        function buildElementsCode(elements, context) {
          var processedCount,
              functionIndex;
          if (elements.length > 0) {
            processedCount = node.elements.length - elements.slice(1).length;
            return buildSequence(generate(elements[0], {
              sp: context.sp,
              env: context.env,
              action: null
            }), buildCondition([op.IF_NOT_ERROR], buildElementsCode(elements.slice(1), {
              sp: context.sp + 1,
              env: context.env,
              action: context.action
            }), buildSequence(processedCount > 1 ? [op.POP_N, processedCount] : [op.POP], [op.POP_CURR_POS], [op.PUSH_FAILED])));
          } else {
            if (context.action) {
              functionIndex = addFunctionConst(objects.keys(context.env), context.action.code);
              return buildSequence([op.LOAD_SAVED_POS, node.elements.length], buildCall(functionIndex, node.elements.length, context.env, context.sp), [op.NIP]);
            } else {
              return buildSequence([op.WRAP, node.elements.length], [op.NIP]);
            }
          }
        }
        return buildSequence([op.PUSH_CURR_POS], buildElementsCode(node.elements, {
          sp: context.sp + 1,
          env: context.env,
          action: context.action
        }));
      },
      labeled: function(node, context) {
        var env = objects.clone(context.env);
        context.env[node.label] = context.sp + 1;
        return generate(node.expression, {
          sp: context.sp,
          env: env,
          action: null
        });
      },
      text: function(node, context) {
        return buildSequence([op.PUSH_CURR_POS], generate(node.expression, {
          sp: context.sp + 1,
          env: objects.clone(context.env),
          action: null
        }), buildCondition([op.IF_NOT_ERROR], buildSequence([op.POP], [op.TEXT]), [op.NIP]));
      },
      simple_and: function(node, context) {
        return buildSimplePredicate(node.expression, false, context);
      },
      simple_not: function(node, context) {
        return buildSimplePredicate(node.expression, true, context);
      },
      optional: function(node, context) {
        return buildSequence(generate(node.expression, {
          sp: context.sp,
          env: objects.clone(context.env),
          action: null
        }), buildCondition([op.IF_ERROR], buildSequence([op.POP], [op.PUSH_NULL]), []));
      },
      zero_or_more: function(node, context) {
        var expressionCode = generate(node.expression, {
          sp: context.sp + 1,
          env: objects.clone(context.env),
          action: null
        });
        return buildSequence([op.PUSH_EMPTY_ARRAY], expressionCode, buildAppendLoop(expressionCode), [op.POP]);
      },
      one_or_more: function(node, context) {
        var expressionCode = generate(node.expression, {
          sp: context.sp + 1,
          env: objects.clone(context.env),
          action: null
        });
        return buildSequence([op.PUSH_EMPTY_ARRAY], expressionCode, buildCondition([op.IF_NOT_ERROR], buildSequence(buildAppendLoop(expressionCode), [op.POP]), buildSequence([op.POP], [op.POP], [op.PUSH_FAILED])));
      },
      semantic_and: function(node, context) {
        return buildSemanticPredicate(node.code, false, context);
      },
      semantic_not: function(node, context) {
        return buildSemanticPredicate(node.code, true, context);
      },
      rule_ref: function(node) {
        return [op.RULE, asts.indexOfRule(ast, node.name)];
      },
      literal: function(node) {
        var stringIndex,
            expectedIndex;
        if (node.value.length > 0) {
          stringIndex = addConst('"' + js.stringEscape(node.ignoreCase ? node.value.toLowerCase() : node.value) + '"');
          expectedIndex = addConst(['{', 'type: "literal",', 'value: "' + js.stringEscape(node.value) + '",', 'description: "' + js.stringEscape('"' + js.stringEscape(node.value) + '"') + '"', '}'].join(' '));
          return buildCondition(node.ignoreCase ? [op.MATCH_STRING_IC, stringIndex] : [op.MATCH_STRING, stringIndex], node.ignoreCase ? [op.ACCEPT_N, node.value.length] : [op.ACCEPT_STRING, stringIndex], [op.FAIL, expectedIndex]);
        } else {
          stringIndex = addConst('""');
          return [op.PUSH, stringIndex];
        }
      },
      "class": function(node) {
        var regexp,
            regexpIndex,
            expectedIndex;
        if (node.parts.length > 0) {
          regexp = '/^[' + (node.inverted ? '^' : '') + arrays.map(node.parts, function(part) {
            return part instanceof Array ? js.regexpClassEscape(part[0]) + '-' + js.regexpClassEscape(part[1]) : js.regexpClassEscape(part);
          }).join('') + ']/' + (node.ignoreCase ? 'i' : '');
        } else {
          regexp = node.inverted ? '/^[\\S\\s]/' : '/^(?!)/';
        }
        regexpIndex = addConst(regexp);
        expectedIndex = addConst(['{', 'type: "class",', 'value: "' + js.stringEscape(node.rawText) + '",', 'description: "' + js.stringEscape(node.rawText) + '"', '}'].join(' '));
        return buildCondition([op.MATCH_REGEXP, regexpIndex], [op.ACCEPT_N, 1], [op.FAIL, expectedIndex]);
      },
      any: function() {
        var expectedIndex = addConst('{ type: "any", description: "any character" }');
        return buildCondition([op.MATCH_ANY], [op.ACCEPT_N, 1], [op.FAIL, expectedIndex]);
      }
    });
    generate(ast);
  }
  module.exports = generateBytecode;
})(require('process'));
