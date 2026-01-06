/**
 * TypeScript Test Fixtures - Real Errors
 *
 * This file contains intentional TypeScript errors for testing.
 * It uses test-fixtures/tsconfig.json which is separate from the main project.
 */

// TS2322: Type 'string' is not assignable to type 'number'
const numberValue: number = "this is not a number";

// TS2345: Argument of type 'string' is not assignable to parameter of type 'number'
function addNumbers(a: number, b: number): number {
  return a + b;
}
addNumbers("one", "two");

// TS2304: Cannot find name
const result = nonExistentFunction();

// TS2339: Property does not exist on type
interface User {
  name: string;
  age: number;
}

const user: User = { name: "Alice", age: 30 };
const email = user.email; // Property 'email' does not exist

// TS2741: Property is missing in type
interface RequiredFields {
  id: number;
  name: string;
  email: string;
}

const incomplete: RequiredFields = {
  id: 1,
  name: "Test",
  // missing 'email' property
};

// TS2554: Expected 2 arguments, but got 1
function multiply(a: number, b: number): number {
  return a * b;
}
multiply(5);

// Export to make this a module
export { addNumbers, multiply };
