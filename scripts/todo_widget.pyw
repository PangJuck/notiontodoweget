"""
todo_widget.py를 콘솔 창 없이 실행하기 위한 실행기.

Windows에서 .pyw 파일은 pythonw.exe로 실행되어 콘솔 창이 뜨지 않는다.
바탕화면 상주 위젯이므로 시작프로그램 등록은 이 파일을 쓴다.
로직은 전부 todo_widget.py에 있고 여기서는 그것을 그대로 실행만 한다.
"""

import runpy
from pathlib import Path

runpy.run_path(str(Path(__file__).resolve().with_suffix(".py")), run_name="__main__")
