/**
 * Security Issues Test Fixtures
 * These should trigger security-focused linters (semgrep, eslint-plugin-security)
 */

// eval() - Code injection vulnerability
export function unsafeEval(userInput: string): unknown {
  return eval(userInput);  // DANGER: arbitrary code execution
}

// new Function() - Similar to eval
export function unsafeFunction(code: string): unknown {
  const fn = new Function('return ' + code);
  return fn();
}

// SQL Injection vulnerability pattern
export function unsafeQuery(userId: string): string {
  // Direct string concatenation in SQL - vulnerable!
  const query = "SELECT * FROM users WHERE id = '" + userId + "'";
  return query;
}

// Command injection vulnerability
import { exec } from 'child_process';

export function unsafeExec(filename: string): void {
  // Direct user input in shell command
  exec('cat ' + filename, (_error, stdout) => {
    console.log(stdout);
  });
}

// Hardcoded credentials
export const config = {
  apiKey: 'sk-1234567890abcdef',  // Hardcoded API key
  password: 'admin123',           // Hardcoded password
  secret: 'super-secret-value',   // Hardcoded secret
};

// innerHTML XSS vulnerability pattern
export function unsafeRender(userContent: string): void {
  if (typeof document !== 'undefined') {
    document.getElementById('content')!.innerHTML = userContent;
  }
}

// Regex DoS (ReDoS) - catastrophic backtracking
export function vulnerableRegex(input: string): boolean {
  // This regex is vulnerable to ReDoS
  const pattern = /^(a+)+$/;
  return pattern.test(input);
}
