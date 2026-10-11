import os
from pathlib import Path as InvestigationPath
os.chdir(InvestigationPath(__file__).resolve().parent.parent)
import sys
from pathlib import Path
sys.path.insert(0, str(Path('../tools/tool-deps').resolve()))
from loguru import logger
logger.remove()
from androguard.core.dex import DEX

classes = [
    'Lcom/bodi/treadmill/core/impl/BaseRunner;',
    'Lcom/bodi/treadmill/core/impl/NormalRunner;',
    'Lcom/bodi/treadmill/core/impl/CountdownRunner;',
    'Lcom/bodi/treadmill/core/Mode;',
    'Lcom/bodi/treadmill/core/RunParam;',
    'Lcom/bodi/treadmill/core/impl/SerialComm;',
    'Lcom/bodi/treadmill/core/impl/ValueProtocol;',
    'Lcom/bodi/treadmill/core/impl/ValueProtocol16;',
    'Lcom/bodi/treadmill/core/impl/BaseProtocol;',
    'Lcom/bodi/treadmill/service/AbsRunnerService;',
    'Lcom/bodi/treadmill/service/CommandHandler;',
    'Lcom/bodi/treadmill/ui/RunningActivity;',
    'Lcom/bodi/treadmill/ui/SpeedControlActivity;',
    'Lcom/bodi/treadmill/ui/InclineControlActivity;',
]
lines = []
for path in ['app/classes.dex', 'app/classes2.dex']:
    dex = DEX(Path(path).read_bytes())
    for cls in dex.get_classes():
        name = cls.get_name()
        if name not in classes and not name.startswith('Lcom/bodi/treadmill/core/impl/SerialComm$'):
            continue
        for method in cls.get_methods():
            lines.append(f'\nMETHOD {name} {method.get_name()} {method.get_descriptor()} flags={method.get_access_flags_string()}')
            code = method.get_code()
            if not code:
                continue
            lines.append(f'registers={code.get_registers_size()} inputs={code.get_ins_size()}')
            offset = 0
            for instruction in method.get_instructions():
                lines.append(f'{offset:04x}: {instruction.get_name()} {instruction.get_output()}')
                offset += instruction.get_length()
Path(sys.argv[1] if len(sys.argv) > 1 else 'app/control-disassembly.txt').write_text('\n'.join(lines), encoding='utf-8')
print('Wrote', len(lines), 'lines')
