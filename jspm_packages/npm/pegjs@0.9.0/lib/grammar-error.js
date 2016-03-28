/* */ 
"use strict";
var classes = require('./utils/classes');
function GrammarError(message, location) {
  this.name = "GrammarError";
  this.message = message;
  this.location = location;
  if (typeof Error.captureStackTrace === "function") {
    Error.captureStackTrace(this, GrammarError);
  }
}
classes.subclass(GrammarError, Error);
module.exports = GrammarError;
