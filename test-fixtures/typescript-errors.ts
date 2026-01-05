/**
 * TypeScript Test Fixtures
 * These should trigger TypeScript compiler errors
 */

// TS2322: Type 'string' is not assignable to type 'number'
// @ts-expect-error - Intentionally unused for testing TypeScript errors
const numberValue: number = 'this is not a number';

// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
function addNumbers(a: number, b: number): number {
  return a + b;
}
addNumbers('one', 'two');

// TS2304: Cannot find name
// @ts-expect-error - Intentionally unused for testing TypeScript errors
const result = nonExistentFunction();

// TS2339: Property does not exist on type
interface User {
  name: string;
  age: number;
}

const user: User = { name: 'Alice', age: 30 };
// @ts-expect-error - Intentionally unused for testing TypeScript errors
const email = user.email; // Property 'email' does not exist

// TS7006: Parameter implicitly has 'any' type (with strict mode)
function processData(data) {
  return data.value;
}

export { addNumbers, processData };
