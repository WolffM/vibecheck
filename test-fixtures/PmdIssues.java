/**
 * PMD test file - intentionally dirty code for Java code analysis
 * Minimal version with just 1-2 PMD violations
 */
package testfixtures;

public class PmdIssues {

    // UnusedPrivateField - PMD rule violation
    private String unusedField = "never used";

    // EmptyCatchBlock - PMD rule violation
    public void emptyCatch() {
        try {
            throw new RuntimeException("test");
        } catch (RuntimeException e) {
            // intentionally empty catch block
        }
    }

    public static void main(String[] args) {
        System.out.println("PMD test file");
    }
}
