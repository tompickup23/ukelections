#!/usr/bin/env python3
"""
Quick test script to verify the Streamlit app's data loading
"""
import pandas as pd
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')

folder = Path.home() / "Documents" / "LCC"

def load_all_spending_data():
    """Load and combine all CSV files from LCC folder"""
    all_files = sorted(folder.glob("*.csv")) + sorted(folder.glob("*.xlsx"))

    if not all_files:
        print("No data files found")
        return None

    dfs = []
    file_info = []

    for file_path in all_files:
        try:
            # Read file
            if file_path.suffix.lower() == '.csv':
                df = None
                for encoding in ['utf-8', 'latin-1', 'iso-8859-1', 'cp1252']:
                    try:
                        df = pd.read_csv(file_path, encoding=encoding)
                        break
                    except:
                        continue

                if df is None:
                    continue
            else:
                df = pd.read_excel(file_path, engine='openpyxl')

            if df.empty:
                continue

            # Standardize column names to lowercase
            df.columns = [col.lower().strip() for col in df.columns]

            # Add metadata
            df['source_file'] = file_path.name

            # Try to parse dates
            for date_col in ['date', 'transaction date', 'posting date']:
                if date_col in df.columns:
                    df['date'] = pd.to_datetime(df[date_col], errors='coerce', dayfirst=True)
                    break

            # Try to parse amounts
            for amount_col in ['amount', 'value', 'net amount', 'gross amount']:
                if amount_col in df.columns:
                    df['amount'] = pd.to_numeric(df[amount_col], errors='coerce')
                    break

            dfs.append(df)
            file_info.append(f"{file_path.name}: {len(df):,} rows")

        except Exception as e:
            print(f"Error reading {file_path.name}: {str(e)}")

    if not dfs:
        print("No data could be loaded")
        return None

    # Combine all data
    combined = pd.concat(dfs, ignore_index=True)

    # Drop completely empty columns
    combined = combined.dropna(axis=1, how='all')

    print(f"✓ Loaded {len(combined):,} records from {len(file_info)} files\n")
    
    return combined, file_info


# Run the test
print("Testing data loading...\n")
result = load_all_spending_data()

if result:
    combined, file_info = result
    
    print("File breakdown:")
    for info in file_info:
        print(f"  {info}")
    
    print(f"\nTotal records: {len(combined):,}")
    print(f"\nColumns in combined dataset:")
    for col in combined.columns:
        print(f"  - {col}")
    
    print(f"\nData types:")
    print(combined.dtypes)
    
    print(f"\nDate range:")
    if 'date' in combined.columns:
        print(f"  From: {combined['date'].min()}")
        print(f"  To: {combined['date'].max()}")
    
    print(f"\nAmount statistics:")
    if 'amount' in combined.columns:
        print(f"  Min: £{combined['amount'].min():,.2f}")
        print(f"  Max: £{combined['amount'].max():,.2f}")
        print(f"  Mean: £{combined['amount'].mean():,.2f}")
        print(f"  Total: £{combined['amount'].sum():,.2f}")
    
    print(f"\nSample data (first 3 rows):")
    print(combined.head(3).to_string())
    
    # Check for key columns
    print(f"\nKey column detection:")
    dept_cols = [c for c in combined.columns if any(x in c for x in ['department', 'organisational', 'service', 'directorate'])]
    cat_cols = [c for c in combined.columns if any(x in c for x in ['category', 'expenditure', 'type'])]
    supp_cols = [c for c in combined.columns if any(x in c for x in ['supplier', 'vendor', 'contractor', 'payee'])]
    
    print(f"  Department columns: {dept_cols}")
    print(f"  Category columns: {cat_cols}")
    print(f"  Supplier columns: {supp_cols}")
