# Mypy test file - intentionally dirty code for type checking
# This file triggers various Mypy type errors

from typing import List, Dict, Optional, Union, Callable


# Return type mismatch
def returns_wrong_type() -> str:
    return 42  # error: Incompatible return value type (got "int", expected "str")


# Argument type mismatch
def expects_string(s: str) -> None:
    print(s)


def call_with_wrong_type():
    expects_string(123)  # error: Argument 1 has incompatible type "int"; expected "str"


# Missing return statement
def missing_return() -> int:
    x = 5
    # error: Missing return statement


# Incompatible types in assignment
def incompatible_assignment():
    x: str = "hello"
    x = 42  # error: Incompatible types in assignment


# None handling issues
def none_issues(x: Optional[str]) -> str:
    return x.upper()  # error: Item "None" of "Optional[str]" has no attribute "upper"


# List type issues
def list_type_issues():
    items: List[int] = [1, 2, 3]
    items.append("four")  # error: Argument 1 has incompatible type "str"; expected "int"


# Dict type issues
def dict_type_issues():
    data: Dict[str, int] = {"a": 1}
    data["b"] = "two"  # error: Incompatible types in assignment


# Union type narrowing issues
def union_issues(x: Union[int, str]) -> int:
    return x + 1  # error: Unsupported operand types for + ("str" and "int")


# Callable type issues
def callable_issues():
    func: Callable[[int], str] = lambda x: x * 2  # error: Incompatible return type


# Attribute access on wrong type
class MyClass:
    def __init__(self):
        self.value: int = 0


def attribute_issues():
    obj: MyClass = MyClass()
    print(obj.nonexistent)  # error: "MyClass" has no attribute "nonexistent"


# Incompatible override
class Base:
    def method(self, x: int) -> str:
        return str(x)


class Derived(Base):
    def method(self, x: str) -> int:  # error: Argument 1 incompatible with supertype
        return len(x)


# Generic type issues
def generic_issues():
    from typing import TypeVar

    T = TypeVar('T')

    def identity(x: T) -> T:
        return x

    result: str = identity(42)  # error: Incompatible types in assignment


# Protocol violations
from typing import Protocol


class Drawable(Protocol):
    def draw(self) -> None: ...


class Circle:
    pass  # Missing draw method


def draw_shape(shape: Drawable) -> None:
    shape.draw()


def protocol_violation():
    c = Circle()
    draw_shape(c)  # error: Argument 1 has incompatible type "Circle"


# Literal type issues
from typing import Literal


def literal_issues():
    mode: Literal["read", "write"] = "execute"  # error: Incompatible types


# TypedDict issues
from typing import TypedDict


class Person(TypedDict):
    name: str
    age: int


def typeddict_issues():
    person: Person = {"name": "Alice"}  # error: Missing key 'age'
    person["height"] = 170  # error: TypedDict "Person" has no key 'height'


# Overload issues
from typing import overload


@overload
def process(x: int) -> int: ...
@overload
def process(x: str) -> str: ...


def process(x):  # error: Missing type annotation
    return x


# Variance issues


def variance_issues():
    ints: List[int] = [1, 2, 3]
    objects: List[object] = ints  # error: Incompatible types (invariance)
