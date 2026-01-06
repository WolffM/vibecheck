/**
 * SpotBugs test file - intentionally dirty code for bytecode analysis
 * This file triggers various SpotBugs bug patterns
 * NOTE: Requires compilation to .class files for SpotBugs to analyze
 */
package testfixtures;

import java.util.List;
import java.util.Date;
import java.util.Random;
import java.io.*;
import java.security.*;
import java.sql.*;

public class SpotBugsIssues {

    // NP_NULL_ON_SOME_PATH - Null pointer dereference
    public int nullDereference(String s) {
        if (s == null) {
            System.out.println("null");
        }
        return s.length();  // Bug: s could be null
    }

    // NP_ALWAYS_NULL - Null value is always dereferenced
    public void alwaysNull() {
        String s = null;
        System.out.println(s.length());  // Bug: s is always null
    }

    // RCN_REDUNDANT_NULLCHECK_OF_NONNULL_VALUE
    public void redundantNullCheck() {
        String s = "hello";
        if (s != null) {  // Bug: redundant null check
            System.out.println(s);
        }
    }

    // EC_UNRELATED_TYPES - equals() comparison of unrelated types
    public boolean unrelatedEquals() {
        String s = "hello";
        Integer i = 42;
        return s.equals(i);  // Bug: comparing String with Integer
    }

    // ES_COMPARING_STRINGS_WITH_EQ - String comparison using ==
    public boolean stringEqualityBug(String a, String b) {
        return a == b;  // Bug: should use .equals()
    }

    // HE_EQUALS_NO_HASHCODE - equals without hashCode
    static class NoHashCode {
        private int value;

        @Override
        public boolean equals(Object obj) {
            if (obj instanceof NoHashCode) {
                return value == ((NoHashCode) obj).value;
            }
            return false;
        }
        // Bug: Missing hashCode() override
    }

    // SE_NO_SERIALVERSIONID - Serializable class without serialVersionUID
    static class MissingSerialVersionUID implements Serializable {
        private String data;  // Bug: missing serialVersionUID
    }

    // SE_BAD_FIELD - Non-serializable field in serializable class
    static class BadSerializableField implements Serializable {
        private static final long serialVersionUID = 1L;
        private Thread thread;  // Bug: Thread is not serializable
    }

    // EI_EXPOSE_REP - May expose internal representation by returning array
    private String[] internalArray = {"a", "b", "c"};

    public String[] getInternalArray() {
        return internalArray;  // Bug: exposes internal representation
    }

    // EI_EXPOSE_REP2 - May expose internal representation by storing user array
    private Date internalDate;

    public void setDate(Date date) {
        this.internalDate = date;  // Bug: stores mutable object directly
    }

    // RV_RETURN_VALUE_IGNORED - Return value ignored
    public void ignoreReturnValue() {
        String s = "hello";
        s.toUpperCase();  // Bug: return value ignored
    }

    // RV_RETURN_VALUE_IGNORED_BAD_PRACTICE - File.delete() return ignored
    public void ignoreDeleteReturn() {
        File f = new File("temp.txt");
        f.delete();  // Bug: return value should be checked
    }

    // DM_DEFAULT_ENCODING - Reliance on default encoding
    public void defaultEncoding() throws IOException {
        FileReader reader = new FileReader("file.txt");  // Bug: uses default encoding
        InputStreamReader isr = new InputStreamReader(System.in);  // Bug: uses default encoding
    }

    // DM_BOXED_PRIMITIVE_FOR_PARSING
    public int inefficientParsing(String s) {
        return new Integer(s);  // Bug: should use Integer.parseInt()
    }

    // DM_NUMBER_CTOR - Inefficient number constructor
    public Integer inefficientInteger() {
        return new Integer(42);  // Bug: should use Integer.valueOf()
    }

    // SQL_NONCONSTANT_STRING_PASSED_TO_EXECUTE - SQL injection
    public void sqlInjection(Connection conn, String userInput) throws SQLException {
        Statement stmt = conn.createStatement();
        stmt.execute("SELECT * FROM users WHERE name = '" + userInput + "'");  // Bug: SQL injection
    }

    // STCAL_INVOKE_ON_STATIC_DATE_FORMAT_INSTANCE - Thread-unsafe date format
    private static final java.text.SimpleDateFormat DATE_FORMAT =
        new java.text.SimpleDateFormat("yyyy-MM-dd");

    public String formatDate(Date date) {
        return DATE_FORMAT.format(date);  // Bug: thread-unsafe static DateFormat
    }

    // URF_UNREAD_FIELD - Unread field
    private int unreadField = 42;

    public void writeUnreadField() {
        unreadField = 100;  // Written but never read
    }

    // UWF_UNWRITTEN_FIELD - Unwritten field is read
    private String unwrittenField;

    public String readUnwrittenField() {
        return unwrittenField;  // Bug: field is never written
    }

    // DLS_DEAD_LOCAL_STORE - Dead store to local variable
    public void deadStore() {
        int x = 10;
        x = 20;  // Bug: previous value is never used
        System.out.println(x);
    }

    // IS2_INCONSISTENT_SYNC - Inconsistent synchronization
    private int counter = 0;

    public synchronized void increment() {
        counter++;
    }

    public int getCounter() {
        return counter;  // Bug: accessed without sync while increment is synchronized
    }

    // WA_NOT_IN_LOOP - wait() not in loop
    public synchronized void incorrectWait() throws InterruptedException {
        if (!isReady()) {
            wait();  // Bug: should be in a while loop
        }
    }

    private boolean isReady() {
        return false;
    }

    // NN_NAKED_NOTIFY - notify() without changing state
    public synchronized void nakedNotify() {
        notify();  // Bug: notify without state change
    }

    // DC_DOUBLECHECK - Double-checked locking
    private volatile Object resource;

    public Object getResource() {
        if (resource == null) {
            synchronized (this) {
                if (resource == null) {
                    resource = new Object();  // Bug: broken double-checked locking pattern
                }
            }
        }
        return resource;
    }

    // DMI_RANDOM_USED_ONLY_ONCE - Random object created and used only once
    public int singleRandom() {
        return new Random().nextInt();  // Bug: should reuse Random instance
    }

    // ICAST_IDIV_CAST_TO_DOUBLE - Integer division cast to double
    public double divisionPrecision(int a, int b) {
        return (double) (a / b);  // Bug: integer division before cast
    }

    // INT_BAD_REM_BY_1 - Integer remainder modulo 1
    public int remByOne(int x) {
        return x % 1;  // Bug: always returns 0
    }

    // FE_FLOATING_POINT_EQUALITY - Floating point equality comparison
    public boolean floatEquals(double a, double b) {
        return a == b;  // Bug: should use epsilon comparison
    }

    // BC_UNCONFIRMED_CAST - Unchecked cast
    public void uncheckedCast(Object obj) {
        String s = (String) obj;  // Bug: unchecked cast
        System.out.println(s);
    }

    // OS_OPEN_STREAM - Stream not closed
    public void unclosedStream() throws IOException {
        FileInputStream fis = new FileInputStream("file.txt");
        fis.read();  // Bug: stream never closed
    }

    // ODR_OPEN_DATABASE_RESOURCE - Database resource not closed
    public void unclosedConnection() throws SQLException {
        Connection conn = DriverManager.getConnection("jdbc:h2:mem:test");
        Statement stmt = conn.createStatement();
        ResultSet rs = stmt.executeQuery("SELECT 1");
        // Bug: resources never closed
    }

    // MS_SHOULD_BE_FINAL - Field should be final
    public static String CONSTANT = "value";  // Bug: should be final

    // MS_MUTABLE_ARRAY - Public static mutable array
    public static final String[] MUTABLE_ARRAY = {"a", "b", "c"};  // Bug: mutable array exposed

    // CNT_ROUGH_CONSTANT_VALUE - Rough value of known constant
    public double roughPi() {
        return 3.14;  // Bug: should use Math.PI
    }

    // VA_FORMAT_STRING_USES_NEWLINE - Format string with \n instead of %n
    public void formatNewline() {
        System.out.printf("Hello\n");  // Bug: should use %n for portability
    }
}
