import subprocess, sys, pathlib
d = pathlib.Path(__file__).parent
for s in ["06_pulses.py", "07_bus_arrivals.py", "08_quick_transfers.py", "08b_placebo.py", "09_recommend.py", "10_regulars.py", "13_route_flows.py", "14_suburban.py", "11_export.py", "12_contract_check.py", "15_consistency.py"]:
    print(">>", s, flush=True); subprocess.run([sys.executable, str(d / s)], check=True, cwd=d)
