/**
 * SpotBugs test file - intentionally dirty code for bytecode analysis
 * Minimal version with just 1-2 SpotBugs violations
 * NOTE: Requires compilation to .class files for SpotBugs to analyze
 */
package testfixtures;

public class SpotBugsIssues {

    // NP_ALWAYS_NULL - Null value is always dereferenced
    public void alwaysNull() {
        String s = null;
        System.out.println(s.length());  // Bug: s is always null
    }

    // ES_COMPARING_STRINGS_WITH_EQ - String comparison using ==
    public boolean stringEqualityBug(String a, String b) {
        return a == b;  // Bug: should use .equals()
    }

    public static void main(String[] args) {
        System.out.println("SpotBugs test file");
    }
}
