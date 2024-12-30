import socket
import os
import threading
import logging
import stat
import time

# FTP 服务器配置
FTP_PORT = 2121  # FTP 控制端口
BUFFER_SIZE = 1024
DATA_PORT = 20  # 数据端口，默认FTP数据传输端口

# 目录配置
default_date_readwrite = "./data_rw"
default_date_readonly = "./data_r"

# 用户权限配置
users = {
    "rw": {"password": "123", "directory": default_date_readwrite, "permissions": "elradfmw"},
    "readonly": {"password": "password123", "directory": default_date_readonly, "permissions": "elr"},
}

# 确保目录存在
def ensure_directory_exists(directory_path):
    if not os.path.exists(directory_path):
        os.makedirs(directory_path)
        print(f"文件夹 {directory_path} 已创建")
    else:
        print(f"文件夹 {directory_path} 已存在")

# 日志配置
def setup_logging():
    logging.basicConfig(
        filename="ftp_server.log",
        level=logging.INFO,
        format="%(asctime)s - %(levelname)s - %(message)s",
    )

# 创建一个新的客户端处理线程
def handle_client(client_socket, client_address):
    logging.info(f"Connection from {client_address}...")
    print(f"Client {client_address} connected.")
    client_socket.send(b"220 Welcome to the FTP Server\r\n")

    logged_in = False
    username = None
    password = None
    passive_mode = False
    data_socket = None
    rest_offset = 0
    user_info = None

    while True:
        # 接收客户端请求
        data = client_socket.recv(BUFFER_SIZE).decode('utf-8').strip()
        if not data:
            continue
        logging.info(f"Received command: {data}")

        # 用户认证
        if data.startswith("USER"):
            username = data.split()[1]
            if username in users:
                user_info = users[username]
                client_socket.send(b"331 Username OK, need password.\r\n")
            else:
                client_socket.send(b"530 Invalid username.\r\n")
        elif data.startswith("PASS"):
            if user_info and data.split()[1] == user_info["password"]:
                logged_in = True
                # 设置登录后用户的工作目录
                current_directory = user_info["directory"]
                client_socket.send(b"230 User logged in, proceed.\r\n")
                client_socket.send(f"250 Current directory is {current_directory}\r\n".encode())
            else:
                client_socket.send(b"530 Login incorrect.\r\n")

        # 切换到被动模式
        elif data.startswith("PASV"):
            passive_mode = True
            data_socket, port = enter_passive_mode()
            p1, p2 = port // 256, port % 256
            client_socket.send(f"227 Entering Passive Mode (127,0,0,1,{p1},{p2}).\r\n".encode())

        # REST 命令，用于断点续传
        elif data.startswith("REST"):
            rest_offset = int(data.split()[1])
            client_socket.send(b"350 Restarting at byte offset.\r\n")

        # 列出目录
        elif data.startswith("LIST"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            # 确保当前目录是最新的
            current_directory = user_info["directory"]  # 确保使用用户的工作目录
            list_files(client_socket, data_socket, passive_mode, current_directory, user_info)

        # 设置传输模式
        elif data.startswith("TYPE"):
            mode = data.split()[1]
            if mode == "I":
                client_socket.send(b"200 Type set to I.\r\n")
            else:
                client_socket.send(b"504 Command not implemented for that parameter.\r\n")

        # 下载文件
        elif data.startswith("RETR"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            if 'r' not in user_info["permissions"]:
                client_socket.send(b"550 Permission denied.\r\n")
                continue
            file_name = data.split()[1] if len(data.split()) > 1 else None
            if not file_name:
                client_socket.send(b"550 File not specified.\r\n")
                continue
            retrieve_file(client_socket, data_socket, file_name, passive_mode, rest_offset, current_directory)
            rest_offset = 0  # 重置断点

        # 获取文件大小
        elif data.startswith("SIZE"):
            file_name = data.split()[1] if len(data.split()) > 1 else None
            if not file_name:
                client_socket.send(b"550 File not specified.\r\n")
                continue
            file_path = os.path.join(current_directory, file_name)
            try:
                #检查文件是否存在
                if os.path.isfile(file_path):
                    #获取文件大小
                    file_size = os.path.getsize(file_path)
                    print(f"File size of {file_name}: {file_size} bytes")
                    client_socket.send(f"213 {file_size}\r\n".encode())
                else:
                    client_socket.send(f"550 File not found.\r\n") # 文件不存在
            except Exception as e:
                    client_socket.send(b"550 Failed to retrieve file size.\r\n")  # 处理任何异常
                    logging.error(f"Error retrieving file size: {e}")
            #if os.path.isfile(file_path):
                #file_size = os.path.getsize(file_path)
                #print('file_size', file_size)
                #client_socket.send(f"213 {file_size}\r\n".encode())
           #else:
                #client_socket.send(b"550 File not found.\r\n")

        # 上传文件
        elif data.startswith("STOR"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            if 'w' not in user_info["permissions"]:
                client_socket.send(b"550 Permission denied.\r\n")
                continue
            file_name = data.split()[1]
            store_file(client_socket, data_socket, file_name, passive_mode, rest_offset, current_directory)
            rest_offset = 0  # 重置断点

        # 退出连接
        elif data.startswith("QUIT"):
            client_socket.send(b"221 Goodbye.\r\n")
            client_socket.close()
            if data_socket:
                data_socket.close()
            logging.info(f"Client {client_address} disconnected.")
            break

        # 中止传输
        elif data.startswith("ABOR"):
            client_socket.send(b"226 Abort command successful.\r\n")
            if data_socket:
                data_socket.close()
            logging.info(f"Abort command received from {client_address}.")

        # 更改目录
        elif data.startswith("CWD"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            directory = data.split()[1]
            new_directory = os.path.join(current_directory, directory)
            if os.path.isdir(new_directory):
                current_directory = new_directory
                client_socket.send(b"250 Directory successfully changed.\r\n")
            else:
                client_socket.send(b"550 Failed to change directory.\r\n")

        # 添加DELE命令处理
        elif data.startswith("DELE"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            # 检查用户是否有删除权限
            if 'd' not in user_info["permissions"]:
                client_socket.send(b"550 Permission denied.\r\n")
                continue
            # 获取要删除的文件名
            file_name = data.split()[1] if len(data.split()) > 1 else None
            if not file_name:
                client_socket.send(b"550 File name not specified.\r\n")
                continue
            # 删除文件
            delete_file(client_socket, file_name, current_directory)

        # 添加RMD命令处理
        elif data.startswith("RMD"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            # 检查用户是否有删除权限
            if 'd' not in user_info["permissions"]:
                client_socket.send(b"550 Permission denied.\r\n")
                continue
            # 获取要删除的目录名
            dir_name = data.split()[1] if len(data.split()) > 1 else None
            if not dir_name:
                client_socket.send(b"550 Directory name not specified.\r\n")
                continue
            # 删除目录
            remove_directory(client_socket, dir_name, current_directory)

        # 添加PWD命令处理
        elif data.startswith("PWD"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            # 发送当前工作目录
            response = f'257 "{current_directory}" is current directory.\r\n'
            client_socket.send(response.encode())
            logging.info(f"PWD command - current directory: {current_directory}")

        # 返回父目录
        elif data.startswith("CDUP"):
            if not logged_in:
                client_socket.send(b"530 Not logged in.\r\n")
                continue
            parent_directory = os.path.dirname(current_directory)
            if os.path.isdir(parent_directory):
                current_directory = parent_directory
                client_socket.send(b"250 Directory successfully changed to parent.\r\n")
            else:
                client_socket.send(b"550 Failed to change to parent directory.\r\n")

        else:
            client_socket.send(b"500 Command not understood.\r\n")

# 进入被动模式
def enter_passive_mode():
    data_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    data_socket.bind(('0.0.0.0', 0))  # 绑定到随机端口
    data_socket.listen(1)
    port = data_socket.getsockname()[1]
    return data_socket, port

# 列出目录文件
def list_files(client_socket, data_socket, passive_mode, directory, user_info):
    try:
        # 根据用户权限选择目录
        if user_info["permissions"] == "elradfmw":
            directory = default_date_readwrite
        elif user_info["permissions"] == "elr":
            directory = default_date_readonly

        if passive_mode:
            conn, _ = data_socket.accept()
        else:
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.connect(('localhost', DATA_PORT))

        files = os.listdir(directory)
        client_socket.send(b"150 Here comes the directory listing.\r\n")

        # Send detailed file list
        for file in files:
            file_path = os.path.join(directory, file)
            file_stat = os.stat(file_path)
            permissions = stat.filemode(file_stat.st_mode)
            size = file_stat.st_size
            mod_time = time.strftime("%b %d %H:%M", time.localtime(file_stat.st_mtime))
            file_info = f"{permissions} 1 owner group {size} {mod_time} {file}\r\n"
            conn.send(file_info.encode())

        conn.close()
        client_socket.send(b"226 Directory send OK.\r\n")

    except Exception as e:
        client_socket.send(b"550 Failed to list directory.\r\n")
        logging.error(f"Error listing files: {e}")

# 下载文件
def retrieve_file(client_socket, data_socket, file_name, passive_mode, rest_offset, directory, download_path=None):
    try:
        # 如果提供了下载路径，则使用它，否则使用默认路径
        if download_path:
            file_path = os.path.join(download_path, file_name)
        else:
            file_path = os.path.join(directory, file_name)

        # 检查文件是否存在
        if not os.path.isfile(file_path):
            logging.error(f"File not found: {file_path}")  # 记录错误
            client_socket.send(b"550 File not found.\r\n")
            return

        # 获取文件大小
        file_size = os.path.getsize(file_path)
        logging.info(f"File size: {file_size} bytes")  # 记录文件大小

        if passive_mode:
            conn, _ = data_socket.accept()
        else:
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.connect(('localhost', DATA_PORT))

        client_socket.send(b"150 Opening data connection.\r\n")

        with open(file_path, 'rb') as file:
            file.seek(rest_offset)  # 移动到断点位置
            downloaded_size = rest_offset  # 初始化已下载大小
            while chunk := file.read(BUFFER_SIZE):
                conn.send(chunk)
                downloaded_size += len(chunk)  # 更新已下载大小

                # 计算进度
                progress = (downloaded_size / file_size) * 100
                logging.info(f"Download progress: {progress:.2f}%")

        conn.close()
        client_socket.send(b"226 Transfer complete.\r\n")  # 成功提示

    except Exception as e:
        client_socket.send(b"550 Failed to retrieve file.\r\n")
        logging.error(f"Error retrieving file: {e}")

# 上传文件
def store_file(client_socket, data_socket, file_name, passive_mode, rest_offset, directory):
    try:
        # Sanitize the file name to prevent directory traversal
        file_name = os.path.basename(file_name)
        
        # Ensure the directory exists
        ensure_directory_exists(directory)
        
        # Construct the full file path
        file_path = os.path.join(directory, file_name)
        logging.info(f"Attempting to store file to path: {file_path}")

        if passive_mode:
            conn, _ = data_socket.accept()
        else:
            conn = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            conn.connect(('localhost', DATA_PORT))

        client_socket.send(b"150 Opening data connection.\r\n")

        # Open the file in append mode
        with open(file_path, 'ab') as file:
            file.seek(rest_offset)  # Move to the rest offset position
            while True:
                data = conn.recv(BUFFER_SIZE)
                if not data:
                    break
                file.write(data)
                logging.info(f"Writing data to {file_path}")

        conn.close()
        client_socket.send(b"226 Transfer complete.\r\n")
        logging.info(f"File {file_name} stored successfully.")

    except Exception as e:
        client_socket.send(b"550 Failed to store file.\r\n")
        logging.error(f"Error storing file: {e}")

# 添加删除文件的函数
def delete_file(client_socket, file_name, directory):
    try:
        file_path = os.path.join(directory, file_name)
        
        # 检查文件是否存在
        if not os.path.exists(file_path):
            client_socket.send(b"550 File not found.\r\n")
            logging.error(f"File not found: {file_path}")
            return
            
        # 检查是否为文件（不是目录）
        if not os.path.isfile(file_path):
            client_socket.send(b"550 Not a regular file.\r\n")
            logging.error(f"Not a regular file: {file_path}")
            return

        # 尝试删除文件
        os.remove(file_path)
        client_socket.send(b"250 File deleted successfully.\r\n")
        logging.info(f"File deleted: {file_path}")

    except PermissionError:
        client_socket.send(b"550 Permission denied.\r\n")
        logging.error(f"Permission denied when deleting file: {file_path}")
    except Exception as e:
        client_socket.send(b"550 Delete operation failed.\r\n")
        logging.error(f"Error deleting file {file_path}: {e}")

# 添加删除目录的函数
def remove_directory(client_socket, dir_name, current_directory):
    """
    删除指定的目录
    """
    try:
        dir_path = os.path.join(current_directory, dir_name)
        
        # 安全检查：确保目标路径在允许的目录范围内
        if not os.path.abspath(dir_path).startswith(os.path.abspath(current_directory)):
            client_socket.send(b"550 Access denied.\r\n")
            logging.error(f"Access denied: {dir_path}")
            return

        # 检查目录是否存在
        if not os.path.exists(dir_path):
            client_socket.send(b"550 Directory not found.\r\n")
            logging.error(f"Directory not found: {dir_path}")
            return
            
        # 检查是否为目录
        if not os.path.isdir(dir_path):
            client_socket.send(b"550 Not a directory.\r\n")
            logging.error(f"Not a directory: {dir_path}")
            return

        # 检查目录是否为空
        if os.listdir(dir_path):
            client_socket.send(b"550 Directory not empty.\r\n")
            logging.error(f"Directory not empty: {dir_path}")
            return

        # 尝试删除目录
        os.rmdir(dir_path)
        client_socket.send(b"250 Directory successfully removed.\r\n")
        logging.info(f"Directory removed: {dir_path}")

    except PermissionError:
        client_socket.send(b"550 Permission denied.\r\n")
        logging.error(f"Permission denied when removing directory: {dir_path}")
    except Exception as e:
        client_socket.send(b"550 Remove directory operation failed.\r\n")
        logging.error(f"Error removing directory {dir_path}: {e}")

# 启动FTP服务器
def start_ftp_server():
    ensure_directory_exists(default_date_readwrite)
    ensure_directory_exists(default_date_readonly)
    setup_logging()

    server_socket = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    server_socket.bind(('0.0.0.0', FTP_PORT))
    server_socket.listen(5)
    logging.info(f"FTP server started on port {FTP_PORT}...")

    while True:
        client_socket, client_address = server_socket.accept()
        logging.info(f"Connection from {client_address}")

        # 创建新线程处理客户端请求
        client_thread = threading.Thread(target=handle_client, args=(client_socket, client_address))
        client_thread.start()

if __name__ == "__main__":
    start_ftp_server()
