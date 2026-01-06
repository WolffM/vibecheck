/**
 * TypeScript Test Fixtures
 *
 * NOTE: These files are excluded from tsconfig.json to prevent build failures.
 * TypeScript errors are demonstrated here but won't be reported by tsc.
 * Real TypeScript issues are detected in actual project source code.
 *
 * For demo purposes, these errors are covered by ESLint/trunk instead.
 */

// TS2322: Type 'string' is not assignable to type 'number'
// @ts-expect-error - Intentional demo error (excluded from tsc)
const numberValue: number = "this is not a number";

// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
function addNumbers(a: number, b: number): number {
  return a + b;
}
// @ts-expect-error - Intentional demo error
addNumbers("one", "two");

// TS2304: Cannot find name
// @ts-expect-error - Intentional demo error
const result = nonExistentFunction();

// TS2339: Property does not exist on type
interface User {
  name: string;
  age: number;
}

const user: User = { name: "Alice", age: 30 };
// @ts-expect-error - Intentional demo error
const email = user.email; // Property 'email' does not exist

// TS7006: Parameter implicitly has 'any' type (with strict mode)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function processData(data: any) {
  return data.value;
}

export { addNumbers, processData };
