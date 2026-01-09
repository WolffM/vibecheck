// Rust test file - intentionally dirty code for static analysis
// This file triggers various Clippy warnings and lints
// WARNING: This is intentionally problematic code for testing purposes only!

use std::collections::HashMap;
use std::rc::Rc;
use std::cell::RefCell;

// ============================================================================
// clippy::approx_constant - Using approximate value of a constant
// ============================================================================

pub fn approx_pi() -> f64 {
    3.14159 // Should use std::f64::consts::PI
}

pub fn approx_e() -> f64 {
    2.71828 // Should use std::f64::consts::E
}

// ============================================================================
// clippy::bad_bit_mask - Incorrect bit mask operations
// ============================================================================

pub fn bad_bit_mask(x: u32) -> bool {
    x & 0 == 0 // Always true, bad bit mask
}

// ============================================================================
// clippy::collapsible_if - Nested ifs that can be collapsed
// ============================================================================

pub fn collapsible_if_example(a: bool, b: bool) -> i32 {
    if a {
        if b {
            return 1;
        }
    }
    0
}

// ============================================================================
// clippy::eq_op - Comparing identical expressions
// ============================================================================

pub fn eq_op_example(x: i32) -> bool {
    x == x // Always true
}

// ============================================================================
// clippy::erasing_op - Operation that erases values
// ============================================================================

pub fn erasing_op(x: i32) -> i32 {
    x * 0 // Always 0
}

// ============================================================================
// clippy::inefficient_to_string - Inefficient to_string on &str
// ============================================================================

pub fn inefficient_to_string() -> String {
    let s = "hello";
    s.to_string() // Should use s.to_owned() or String::from(s)
}

// ============================================================================
// clippy::len_zero - Using .len() == 0 instead of .is_empty()
// ============================================================================

pub fn len_zero_check(v: &Vec<i32>) -> bool {
    v.len() == 0 // Should use v.is_empty()
}

pub fn len_not_zero(v: &[i32]) -> bool {
    v.len() > 0 // Should use !v.is_empty()
}

// ============================================================================
// clippy::manual_memcpy - Manual byte copying
// ============================================================================

pub fn manual_memcpy(src: &[u8], dst: &mut [u8]) {
    for i in 0..src.len() {
        dst[i] = src[i]; // Should use copy_from_slice
    }
}

// ============================================================================
// clippy::needless_bool - Needless bool expressions
// ============================================================================

pub fn needless_bool(x: bool) -> bool {
    if x {
        true
    } else {
        false
    }
}

pub fn needless_bool_assign(x: bool) -> bool {
    if x {
        return true;
    }
    return false;
}

// ============================================================================
// clippy::needless_range_loop - Needless range loop
// ============================================================================

pub fn needless_range_loop(v: &[i32]) -> i32 {
    let mut sum = 0;
    for i in 0..v.len() {
        sum += v[i]; // Should iterate directly over v
    }
    sum
}

// ============================================================================
// clippy::or_fun_call - Using unwrap_or with function call
// ============================================================================

pub fn or_fun_call(x: Option<String>) -> String {
    x.unwrap_or(String::new()) // Should use unwrap_or_default() or unwrap_or_else
}

// ============================================================================
// clippy::redundant_clone - Cloning when not needed
// ============================================================================

pub fn redundant_clone() -> String {
    let s = String::from("hello");
    let _ = s.clone(); // s is never used after this
    String::from("world")
}

// ============================================================================
// clippy::redundant_pattern_matching - Redundant pattern matching
// ============================================================================

pub fn redundant_pattern_matching(x: Option<i32>) -> bool {
    match x {
        Some(_) => true,
        None => false,
    }
}

// ============================================================================
// clippy::single_match - Single match arm could be if let
// ============================================================================

pub fn single_match_example(x: Option<i32>) -> i32 {
    match x {
        Some(v) => return v,
        _ => {}
    }
    0
}

// ============================================================================
// clippy::string_lit_as_bytes - Using .as_bytes() on string literal
// ============================================================================

pub fn string_lit_as_bytes() -> &'static [u8] {
    "hello".as_bytes() // Should use b"hello"
}

// ============================================================================
// clippy::useless_vec - Creating a Vec just to iterate
// ============================================================================

pub fn useless_vec() -> i32 {
    let sum: i32 = vec![1, 2, 3].iter().sum(); // Use array instead of vec
    sum
}

// ============================================================================
// clippy::while_let_on_iterator - while let on iterator
// ============================================================================

pub fn while_let_iterator() {
    let v = vec![1, 2, 3];
    let mut iter = v.iter();
    while let Some(x) = iter.next() {
        println!("{}", x); // Should use for loop
    }
}

// ============================================================================
// clippy::ptr_arg - Using &Vec<T> instead of &[T]
// ============================================================================

pub fn ptr_arg_vec(v: &Vec<i32>) -> i32 {
    v.iter().sum() // Parameter should be &[i32]
}

pub fn ptr_arg_string(s: &String) -> usize {
    s.len() // Parameter should be &str
}

// ============================================================================
// clippy::type_complexity - Overly complex types
// ============================================================================

pub fn complex_type() -> Option<Result<HashMap<String, Vec<Option<Rc<RefCell<i32>>>>>, String>> {
    None // This type is way too complex
}

// ============================================================================
// clippy::match_bool - Matching on a boolean
// ============================================================================

pub fn match_bool_example(b: bool) -> i32 {
    match b {
        true => 1,
        false => 0,
    }
}

// ============================================================================
// clippy::map_clone - Using .map(|x| x.clone())
// ============================================================================

pub fn map_clone_example(v: &[String]) -> Vec<String> {
    v.iter().map(|x| x.clone()).collect() // Should use .cloned()
}

// ============================================================================
// clippy::filter_map_identity - Redundant filter_map
// ============================================================================

pub fn filter_map_identity(v: Vec<Option<i32>>) -> Vec<i32> {
    v.into_iter().filter_map(|x| x).collect() // Should use .flatten()
}

// ============================================================================
// clippy::clone_on_copy - Cloning a Copy type
// ============================================================================

pub fn clone_on_copy_example() -> i32 {
    let x: i32 = 42;
    x.clone() // i32 is Copy, no need to clone
}

// ============================================================================
// clippy::cmp_owned - Comparing owned to borrowed
// ============================================================================

pub fn cmp_owned_example(s: &str) -> bool {
    s.to_owned() == "hello" // Should compare borrowed values
}

// ============================================================================
// clippy::unit_arg - Passing unit to a function
// ============================================================================

fn takes_option(_: Option<()>) {}

pub fn unit_arg_example() {
    takes_option(Some(println!("side effect"))); // Passing unit value
}

// ============================================================================
// clippy::search_is_some - Using .find().is_some()
// ============================================================================

pub fn search_is_some(v: &[i32], target: i32) -> bool {
    v.iter().find(|&&x| x == target).is_some() // Should use .any()
}

// ============================================================================
// clippy::chars_next_cmp - Comparing chars().next() to char
// ============================================================================

pub fn chars_next_cmp(s: &str) -> bool {
    s.chars().next() == Some('a') // Should use s.starts_with('a')
}

// ============================================================================
// clippy::unnecessary_fold - Unnecessary fold
// ============================================================================

pub fn unnecessary_fold(v: &[i32]) -> bool {
    v.iter().fold(false, |acc, _| acc || true) // Should use .any()
}

// ============================================================================
// clippy::iter_nth_zero - Using .iter().nth(0)
// ============================================================================

pub fn iter_nth_zero(v: &[i32]) -> Option<&i32> {
    v.iter().nth(0) // Should use .first()
}

// ============================================================================
// clippy::bytes_nth - Using .bytes().nth()
// ============================================================================

pub fn bytes_nth(s: &str) -> Option<u8> {
    s.bytes().nth(3) // Should use s.as_bytes().get(3)
}

// ============================================================================
// clippy::explicit_counter_loop - Manual counter in loop
// ============================================================================

pub fn explicit_counter_loop(v: &[i32]) {
    let mut i = 0;
    for item in v {
        println!("{}: {}", i, item);
        i += 1; // Should use .enumerate()
    }
}

// ============================================================================
// clippy::mut_mut - Multiple mutable references
// ============================================================================

pub fn mut_mut_example(x: &mut &mut i32) {
    **x = 42; // Double mutable reference is confusing
}

// ============================================================================
// clippy::redundant_slicing - Redundant slicing
// ============================================================================

pub fn redundant_slicing(v: &[i32]) -> &[i32] {
    &v[..] // Slicing the whole slice is redundant
}

// ============================================================================
// clippy::manual_filter_map - Manual filter + map
// ============================================================================

pub fn manual_filter_map(v: Vec<Option<i32>>) -> Vec<i32> {
    v.into_iter()
        .filter(|x| x.is_some())
        .map(|x| x.unwrap())
        .collect() // Should use filter_map
}

// ============================================================================
// clippy::option_as_ref_deref - Using as_ref().map(|x| x.as_str())
// ============================================================================

pub fn option_as_ref_deref(s: &Option<String>) -> Option<&str> {
    s.as_ref().map(|x| x.as_str()) // Should use .as_deref()
}

// ============================================================================
// Main function
// ============================================================================

fn main() {
    // Call functions to prevent unused warnings
    println!("pi ≈ {}", approx_pi());
    println!("e ≈ {}", approx_e());
    println!("bad mask: {}", bad_bit_mask(5));
    println!("collapsible: {}", collapsible_if_example(true, true));
    println!("eq_op: {}", eq_op_example(5));
    println!("erasing: {}", erasing_op(5));
    println!("to_string: {}", inefficient_to_string());

    let v = vec![1, 2, 3];
    println!("len_zero: {}", len_zero_check(&v));
    println!("len_not_zero: {}", len_not_zero(&v));

    let mut dst = [0u8; 3];
    manual_memcpy(&[1, 2, 3], &mut dst);

    println!("needless_bool: {}", needless_bool(true));
    println!("needless_bool_assign: {}", needless_bool_assign(true));
    println!("range_loop: {}", needless_range_loop(&v));
    println!("or_fun_call: {}", or_fun_call(None));
    println!("redundant_clone: {}", redundant_clone());
    println!("pattern_matching: {}", redundant_pattern_matching(Some(1)));
    println!("single_match: {}", single_match_example(Some(42)));
    println!("as_bytes: {:?}", string_lit_as_bytes());
    println!("useless_vec: {}", useless_vec());
    while_let_iterator();
    println!("ptr_arg_vec: {}", ptr_arg_vec(&v));
    println!("ptr_arg_string: {}", ptr_arg_string(&String::from("test")));
    println!("complex_type: {:?}", complex_type());
    println!("match_bool: {}", match_bool_example(true));

    let strings = vec!["a".to_string(), "b".to_string()];
    println!("map_clone: {:?}", map_clone_example(&strings));

    let opts = vec![Some(1), None, Some(2)];
    println!("filter_map_identity: {:?}", filter_map_identity(opts));
    println!("clone_on_copy: {}", clone_on_copy_example());
    println!("cmp_owned: {}", cmp_owned_example("hello"));
    unit_arg_example();
    println!("search_is_some: {}", search_is_some(&v, 2));
    println!("chars_next_cmp: {}", chars_next_cmp("abc"));
    println!("unnecessary_fold: {}", unnecessary_fold(&v));
    println!("iter_nth_zero: {:?}", iter_nth_zero(&v));
    println!("bytes_nth: {:?}", bytes_nth("hello"));
    explicit_counter_loop(&v);

    let mut val = 10;
    let mut ref1 = &mut val;
    mut_mut_example(&mut ref1);

    println!("redundant_slicing: {:?}", redundant_slicing(&v));

    let opts2 = vec![Some(1), None, Some(2)];
    println!("manual_filter_map: {:?}", manual_filter_map(opts2));

    let opt_string = Some(String::from("test"));
    println!("option_as_ref_deref: {:?}", option_as_ref_deref(&opt_string));
}
