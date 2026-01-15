# Bandit test file - intentionally dirty code for security scanning
# This file triggers various Bandit security warnings
# WARNING: This is intentionally insecure code for testing purposes only!

import os
import subprocess
import pickle
import hashlib
import tempfile
import random
import ssl


# B101: Assert used - assert statements are removed with compiling to optimized code
def assert_usage(user_input):
    assert user_input is not None, "Input required"
    return user_input


# B102: exec_used - Use of exec detected
def exec_usage(code_string):
    exec(code_string)


# B103: set_bad_file_permissions
def bad_permissions():
    os.chmod("/tmp/secret.txt", 0o777)


# B104: hardcoded_bind_all_interfaces
def bind_all_interfaces():
    import socket
    s = socket.socket()
    s.bind(("0.0.0.0", 8080))


# B105, B106, B107: hardcoded_password_string/funcarg/default
PASSWORD = "super_secret_password123"
API_KEY = "sk-1234567890abcdef"


def connect_db(password="admin123"):
    return f"connecting with {password}"


def login(user, passwd="default_pass"):
    pass


# B108: hardcoded_tmp_directory
def use_tmp():
    with open("/tmp/data.txt", "w") as f:
        f.write("sensitive data")


# B110: try_except_pass - Try/except with pass, ignoring errors
def ignore_errors():
    try:
        risky_operation()
    except Exception:
        pass


def risky_operation():
    pass


# B112: try_except_continue
def continue_on_error(items):
    for item in items:
        try:
            process(item)
        except Exception:
            continue


def process(item):
    pass


# B201: flask_debug_true (simulated)
# B301: pickle - Pickle usage detected
def unsafe_pickle():
    pickle.loads(b"cos\nsystem\n(S'echo hacked'\ntR.")


# B303: md5 - Use of insecure MD5 hash function
def weak_hash(data):
    return hashlib.md5(data.encode()).hexdigest()


# B304: des - Use of insecure cipher
def weak_cipher():
    from Crypto.Cipher import DES
    key = b'12345678'
    DES.new(key, DES.MODE_ECB)


# B305: cipher_modes - Use of insecure cipher mode
def insecure_cipher_mode():
    from Crypto.Cipher import AES
    key = b'sixteen byte key'
    AES.new(key, AES.MODE_ECB)


# B306: mktemp_q - Use of insecure mktemp
def insecure_temp():
    filename = tempfile.mktemp()
    return filename


# B307: eval - Use of eval
def eval_usage(user_input):
    return eval(user_input)


# B308: mark_safe (Django) - simulated
# B310: urllib_urlopen - Audit url open for permitted schemes
def url_open(url):
    import urllib.request
    return urllib.request.urlopen(url)


# B311: random - Use of pseudo-random generator for security
def insecure_random():
    token = random.randint(0, 999999)
    return f"token_{token}"


# B312: telnetlib - Telnet-related functions
def use_telnet():
    import telnetlib
    telnetlib.Telnet("example.com")


# B320, B410: xml - XML parsing vulnerable to XXE attacks
def parse_xml(xml_string):
    import xml.etree.ElementTree as ET
    return ET.fromstring(xml_string)


# B321: ftplib - FTP-related functions
def use_ftp():
    import ftplib
    ftplib.FTP("ftp.example.com")


# B323: unverified_context - SSL certificate verification disabled
def insecure_ssl():
    context = ssl._create_unverified_context()
    return context


# B324: hashlib_new_insecure_functions - Insecure hash functions
def more_weak_hashes(data):
    h1 = hashlib.new('md5')
    hashlib.new('sha1')
    h1.update(data.encode())
    return h1.hexdigest()


# B501: request_with_no_cert_validation
def insecure_request():
    import requests
    requests.get("https://example.com", verify=False)


# B506: yaml_load - Use of unsafe YAML load
def unsafe_yaml(yaml_string):
    import yaml
    return yaml.load(yaml_string)


# B601: paramiko_calls - Paramiko SSH calls
def ssh_command(host, cmd):
    import paramiko
    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, username="root", password="toor")


# B602: subprocess_popen_with_shell_equals_true
def shell_injection(user_input):
    subprocess.Popen(f"echo {user_input}", shell=True)


# B603: subprocess_without_shell_equals_true (still flagged for audit)
def subprocess_call(cmd):
    subprocess.call(cmd)


# B604: any_other_function_with_shell_equals_true
def os_system_call(cmd):
    os.system(cmd)


# B605: start_process_with_a_shell
def popen_shell(cmd):
    os.popen(cmd)


# B607: start_process_with_partial_path
def partial_path_exec():
    subprocess.call(["python", "-c", "print('hello')"])


# B608: hardcoded_sql_expressions - SQL injection
def sql_injection(user_id):
    query = "SELECT * FROM users WHERE id = " + user_id
    return query


# B609: linux_commands_wildcard_injection
def wildcard_injection():
    subprocess.call("tar cf archive.tar *", shell=True)


# B610, B611: django_extra_used, django_rawsql_used - simulated
# B701: jinja2_autoescape_false - Jinja2 templates with autoescape disabled
def jinja_template():
    from jinja2 import Environment
    Environment(autoescape=False)


# B702: use_of_mako_templates - Mako templates (no autoescape)
def mako_template():
    from mako.template import Template
    Template("<html>${user_input}</html>")
