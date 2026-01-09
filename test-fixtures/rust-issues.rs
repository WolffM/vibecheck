// Rust test file - intentionally dirty code for static analysis
// This file triggers exactly 5 Clippy warnings for testing purposes
// WARNING: This is intentionally problematic code for testing purposes only!

// ============================================================================
// Issue 1: clippy::approx_constant - Using approximate value of PI
// ============================================================================

pub fn get_pi() -> f64 {
    3.14159 // Should use std::f64::consts::PI
}

// ============================================================================
// Issue 2: clippy::eq_op - Comparing identical expressions
// ============================================================================

pub fn always_true(x: i32) -> bool {
    x == x // Always true, likely a bug
}

// ============================================================================
// Issue 3: clippy::len_zero - Using .len() == 0 instead of .is_empty()
// ============================================================================

pub fn is_empty_check(v: &[i32]) -> bool {
    v.len() == 0 // Should use v.is_empty()
}

// ============================================================================
// Issue 4: clippy::needless_bool - Needless bool expression
// ============================================================================

pub fn redundant_bool(x: bool) -> bool {
    if x { true } else { false } // Just return x
}

// ============================================================================
// Issue 5: clippy::ptr_arg - Using &Vec<T> instead of &[T]
// ============================================================================

pub fn sum_vec(v: &Vec<i32>) -> i32 {
    v.iter().sum() // Parameter should be &[i32]
}

// ============================================================================
// Main function
// ============================================================================

fn main() {
    println!("pi = {}", get_pi());
    println!("always_true(5) = {}", always_true(5));

    let v = vec![1, 2, 3];
    println!("is_empty = {}", is_empty_check(&v));
    println!("redundant = {}", redundant_bool(true));
    println!("sum = {}", sum_vec(&v));
}
