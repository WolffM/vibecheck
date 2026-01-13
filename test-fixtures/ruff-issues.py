# Ruff test file - intentionally dirty code for linting
# This file triggers various Ruff rules

from collections import *  # F403: Star import

# E501: Line too long (this comment is intentionally very very very very very very very very very very very very long)

def badly_formatted_function(x,y,z):  # E251: Missing whitespace around parameter equals
    """Missing blank lines, bad spacing."""
    a=1  # E225: Missing whitespace around operator
    b =2  # E221: Multiple spaces before operator
    c= 3  # E222: Missing space after operator
    if x==1:  # E225: Missing whitespace around comparison
        pass
    return a+b+c  # E225: Missing whitespace around operator


class badlyNamedClass:  # N801: Class name should use CapWords convention
    def __init__(self):
        self.BadAttribute = 1  # N815: Mixed case variable in class scope

    def BadMethodName(self):  # N802: Function name should be lowercase
        pass


def unused_variable_function():
    unused_var = 42  # F841: Local variable is assigned but never used
    x = 1
    return x


def unreachable_code():
    return 1
    print("never reached")  # F821 style: unreachable code after return


# E302: Expected 2 blank lines, found 1
def missing_blank_lines():
    pass

CONSTANT = "value"
constant_lowercase = "bad"  # N816: Variable in module scope should be UPPER_CASE


# Comparison issues
def comparison_issues(x):
    if x == None:  # E711: Comparison to None should be 'is None'
        pass
    if x == True:  # E712: Comparison to True should be 'if x:' or 'if x is True:'
        pass
    if type(x) == int:  # E721: Use isinstance() instead of type comparison
        pass


# f-string issues
def fstring_issues():
    name = "world"
    greeting = "hello"  # F541: f-string without placeholders
    return greeting


# Lambda assignment
square = lambda x: x * x  # E731: Do not assign a lambda expression, use a def


# Bare except
def bare_except_handler():
    try:
        pass
    except Exception:
        pass


# Mutable default argument
def mutable_default(items=[]):  # B006: Do not use mutable data structures for argument defaults
    items.append(1)
    return items


# Assert with tuple
def assert_tuple():
    assert (1, 2)  # B011: Do not use assert with a tuple, it's always True


# Duplicate keys in dict
duplicate_dict = {
    "key": 1,
    "key": 2,  # Duplicate key
}
