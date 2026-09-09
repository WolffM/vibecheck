/**
 * ESLint Test Fixtures
 * These should trigger various ESLint rules
 */

// no-unused-vars: Declared but never used
// @ts-expect-error - Intentionally unused for testing ESLint rules
const unusedVariable = "I am never used";

// no-var: Use of var instead of let/const
const oldStyleVariable = "should use let or const";

// prefer-const: Variable never reassigned
// @ts-expect-error - Intentionally unused for testing ESLint rules
const shouldBeConst = "I am never reassigned";

// eqeqeq: Using == instead of ===
function looseEquality(a: unknown) {
  if (a == null) {
    // Should be === null || === undefined
    return "nullish";
  }
  return "not nullish";
}

// no-console: Console statements in production code
function debugCode() {
  console.log("Debug message that should not be in production");
  return true;
}

// @typescript-eslint/no-explicit-any: Using any type
function acceptsAny(value: any): any {
  return value;
}

// @typescript-eslint/no-non-null-assertion: Using non-null assertion
function nonNullAssertion(obj: { value?: string }) {
  return obj.value!.length; // Dangerous non-null assertion
}

// no-shadow: Variable shadowing
const shadowedVar = 1;
function shadowExample() {
  const shadowedVar = 2; // Shadows outer variable
  return shadowedVar;
}

// prefer-template: String concatenation instead of template
function concatStrings(name: string) {
  return "Hello, " + name + "!"; // Should use template literal
}

// @typescript-eslint/no-floating-promises: Unhandled promise
async function asyncOperation() {
  return "done";
}
function callerWithFloatingPromise() {
  asyncOperation(); // Promise not awaited or handled
}

// no-return-await: Redundant return await
async function redundantAwait() {
  return await Promise.resolve(42); // await is unnecessary
}

// @typescript-eslint/no-unnecessary-type-assertion: Unnecessary assertion
function unnecessaryAssertion(value: string) {
  return value as string; // Already a string
}

// no-useless-escape: Unnecessary escape character
const uselessEscapeRegex = /\a/; // \a is not a valid escape

// @typescript-eslint/prefer-nullish-coalescing: Use ?? instead of ||
function nullishCoalesce(value: string | null) {
  return value || "default"; // Should use ?? for nullish only
}

// @typescript-eslint/no-unused-expressions: Expression has no effect
function unusedExpression(arr: number[]) {
  arr.length; // Expression result is not used
  return arr;
}

// Export something to make it a module
export {
  looseEquality,
  debugCode,
  acceptsAny,
  nonNullAssertion,
  shadowExample,
  concatStrings,
  callerWithFloatingPromise,
  redundantAwait,
  unnecessaryAssertion,
  uselessEscapeRegex,
  nullishCoalesce,
  unusedExpression,
};
