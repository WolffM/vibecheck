/**
 * ESLint Test Fixtures
 * These should trigger various ESLint rules
 */

// no-unused-vars: Declared but never used
// @ts-expect-error - Intentionally unused for testing ESLint rules
const unusedVariable = 'I am never used';

// no-var: Use of var instead of let/const
var oldStyleVariable = 'should use let or const';

// prefer-const: Variable never reassigned
// @ts-expect-error - Intentionally unused for testing ESLint rules
let shouldBeConst = 'I am never reassigned';

// eqeqeq: Using == instead of ===
function looseEquality(a: unknown) {
  if (a == null) {  // Should be === null || === undefined
    return 'nullish';
  }
  return 'not nullish';
}

// no-console: Console statements in production code
function debugCode() {
  console.log('Debug message that should not be in production');
  return true;
}

// Export something to make it a module
export { looseEquality, debugCode };
