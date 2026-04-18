#!/usr/bin/env python3
"""
Test script to verify filter functionality
"""
import pandas as pd
from pathlib import Path
import warnings

warnings.filterwarnings('ignore')

folder = Path.home() / "Documents" / "LCC"

def load_all_spending_data():
    """Load and combine all CSV files from LCC folder"""
    all_files = sorted(folder.glob("*.csv")) + sorted(folder.glob("*.xlsx"))
    dfs = []

    for file_path in all_files:
        try:
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

            df.columns = [col.lower().strip() for col in df.columns]
            df['source_file'] = file_path.name

            for date_col in ['date', 'transaction date', 'posting date']:
                if date_col in df.columns:
                    df['date'] = pd.to_datetime(df[date_col], errors='coerce', dayfirst=True)
                    break

            for amount_col in ['amount', 'value', 'net amount', 'gross amount']:
                if amount_col in df.columns:
                    df['amount'] = pd.to_numeric(df[amount_col], errors='coerce')
                    break

            dfs.append(df)
        except Exception as e:
            print(f"Error reading {file_path.name}: {str(e)}")

    if not dfs:
        return None

    combined = pd.concat(dfs, ignore_index=True)
    combined = combined.dropna(axis=1, how='all')
    return combined


print("Loading data for filter testing...\n")
df = load_all_spending_data()

if df is not None:
    # Test 1: Date filter
    print("=" * 60)
    print("TEST 1: Date Range Filter")
    print("=" * 60)
    
    if 'date' in df.columns:
        min_date = df['date'].min().date()
        max_date = df['date'].max().date()
        print(f"Date range in data: {min_date} to {max_date}")
        print(f"Total records: {len(df):,}\n")
        
        # Filter to April 2024 only
        april_only = df[(df['date'] >= pd.Timestamp('2024-04-01')) & 
                        (df['date'] < pd.Timestamp('2024-05-01'))]
        print(f"April 2024 only: {len(april_only):,} records")
        
        # Filter to Q4 2024
        q4_2024 = df[(df['date'] >= pd.Timestamp('2024-10-01')) & 
                     (df['date'] < pd.Timestamp('2025-01-01'))]
        print(f"Q4 2024: {len(q4_2024):,} records")
        
        # Filter to 2025
        year_2025 = df[df['date'] >= pd.Timestamp('2025-01-01')]
        print(f"2025 data: {len(year_2025):,} records\n")
    
    # Test 2: Department/Service filter
    print("=" * 60)
    print("TEST 2: Department/Service Filter")
    print("=" * 60)
    
    if 'organisational unit' in df.columns:
        depts = df['organisational unit'].dropna().unique()
        print(f"Unique organisational units: {len(depts)}")
        print("First 10 units:")
        for dept in sorted(depts)[:10]:
            count = len(df[df['organisational unit'] == dept])
            print(f"  {dept}: {count:,} records")
        
        # Test text search filter
        print("\nTest: Filter containing 'Finance':")
        finance = df[df['organisational unit'].str.contains('Finance', case=False, na=False)]
        print(f"  Found: {len(finance):,} records")
    
    print()
    
    # Test 3: Category filter
    print("=" * 60)
    print("TEST 3: Expenditure Category Filter")
    print("=" * 60)
    
    if 'expenditure category' in df.columns:
        cats = df['expenditure category'].dropna().unique()
        print(f"Unique expenditure categories: {len(cats)}")
        print("All categories:")
        for cat in sorted(cats):
            count = len(df[df['expenditure category'] == cat])
            print(f"  {cat}: {count:,} records")
    
    print()
    
    # Test 4: Supplier filter
    print("=" * 60)
    print("TEST 4: Supplier Filter")
    print("=" * 60)
    
    if 'supplier name' in df.columns:
        supps = df['supplier name'].dropna().unique()
        print(f"Unique suppliers: {len(supps)}")
        print("Top 15 suppliers by transaction count:")
        top_supps = df['supplier name'].value_counts().head(15)
        for supp, count in top_supps.items():
            total = df[df['supplier name'] == supp]['amount'].sum()
            print(f"  {supp}: {count:,} transactions (£{total:,.0f})")
        
        # Test text search
        print("\nTest: Filter containing 'NHS':")
        nhs = df[df['supplier name'].str.contains('NHS', case=False, na=False)]
        print(f"  Found: {len(nhs):,} records")
    
    print()
    
    # Test 5: Amount range filter
    print("=" * 60)
    print("TEST 5: Amount Range Filter")
    print("=" * 60)
    
    if 'amount' in df.columns:
        min_amt = df['amount'].min()
        max_amt = df['amount'].max()
        print(f"Amount range: £{min_amt:,.2f} to £{max_amt:,.2f}")
        print(f"Total records: {len(df):,}\n")
        
        # Filter to positive amounts only
        positive = df[df['amount'] > 0]
        print(f"Positive amounts only: {len(positive):,} records")
        
        # Filter to amounts > £10,000
        large = df[df['amount'] > 10000]
        print(f"Amounts > £10,000: {len(large):,} records (£{large['amount'].sum():,.0f})")
        
        # Filter to amounts < £1,000
        small = df[df['amount'] < 1000]
        print(f"Amounts < £1,000: {len(small):,} records")
    
    print()
    
    # Test 6: Combined filters
    print("=" * 60)
    print("TEST 6: Combined Filters (all at once)")
    print("=" * 60)
    
    filtered = df.copy()
    
    # Apply date filter
    filtered = filtered[(filtered['date'] >= pd.Timestamp('2024-10-01')) & 
                        (filtered['date'] < pd.Timestamp('2024-12-31'))]
    print(f"After date filter (Q4 2024): {len(filtered):,} records")
    
    # Apply department filter
    if 'organisational unit' in filtered.columns:
        filtered = filtered[filtered['organisational unit'].str.contains('Finance', case=False, na=False)]
        print(f"After department filter (contains 'Finance'): {len(filtered):,} records")
    
    # Apply amount filter
    if 'amount' in filtered.columns:
        filtered = filtered[(filtered['amount'] > 1000) & (filtered['amount'] < 100000)]
        print(f"After amount filter (£1K-£100K): {len(filtered):,} records")
    
    print(f"\nFinal filtered dataset:")
    if len(filtered) > 0:
        print(f"  Total spend: £{filtered['amount'].sum():,.0f}")
        print(f"  Avg transaction: £{filtered['amount'].mean():,.0f}")
        print(f"  Transactions: {len(filtered):,}")
