import { sql } from '@vercel/postgres';
import {
  CustomerField,
  CustomersTableType,
  InvoiceForm,
  InvoicesTable,
  LatestInvoiceRaw,
  User,
  Revenue,
  Invoice,
  Customer,
  LatestInvoice,
} from './definitions';
import { formatCurrency } from './utils';
import fs from 'node:fs';
import { unstable_noStore as noStore } from 'next/cache';

export function readJsonFile(path: string) {
  const fileContent = fs.readFileSync(path, 'utf8');
  var values = JSON.parse(fileContent);
  // console.log(values);
  return values;
}

export async function fetchRevenue() {
  // Add noStore() here to prevent the response from being cached.
  // This is equivalent to in fetch(..., {cache: 'no-store'}).
  noStore();

  try {
    return readJsonFile('./app/lib/revenue.json');
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchInvoices(): Promise<Invoice[]> {
  // Add noStore() here to prevent the response from being cached.
  // This is equivalent to in fetch(..., {cache: 'no-store'}).
  noStore();

  try {
    return readJsonFile('./app/lib/invoices.json')
      .sort(sortByDateDescending)
      .map((invoice: Invoice, index: number) => ({
        ...invoice,
        id: index,
      }));
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchCustomers(): Promise<Customer[]> {
  // Add noStore() here to prevent the response from being cached.
  // This is equivalent to in fetch(..., {cache: 'no-store'}).
  noStore();

  try {
    return readJsonFile('./app/lib/customers.json');
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

export async function fetchLatestInvoices(): Promise<LatestInvoice[]> {
  noStore();

  try {
    // const data = await sql<LatestInvoiceRaw>`
    //   SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
    //   FROM invoices
    //   JOIN customers ON invoices.customer_id = customers.id
    //   ORDER BY invoices.date DESC
    //   LIMIT 5`;

    const invoices: Invoice[] = await fetchInvoices();
    const customers: Customer[] = await fetchCustomers();

    const data: LatestInvoice[] = invoices.slice(0, 5).map((invoice, i) => {
      const customer = customers.find((e) => e.id === invoice.customer_id)!;

      return {
        amount: invoice.amount.toString(),
        email: customer.email,
        id: invoice.id,
        image_url: customer.image_url,
        name: customer.name,
      };
    });

    const latestInvoices: LatestInvoice[] = data.map((invoice) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount),
    }));
    return latestInvoices;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch the latest invoices.');
  }
}

export async function fetchCardData() {
  noStore();

  try {
    // You can probably combine these into a single SQL query
    // However, we are intentionally splitting them to demonstrate
    // how to initialize multiple queries in parallel with JS.
    const invoicePromise = fetchInvoices();
    const customerPromise = fetchCustomers();
    const invoicesPromise = fetchInvoices();
    // sql`SELECT
    //      SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
    //      SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
    //      FROM invoices`;

    const data = await Promise.all([
      invoicePromise,
      customerPromise,
      invoicesPromise,
    ]);

    const numberOfInvoices = Number(data[0].length ?? '0');
    const numberOfCustomers = Number(data[1].length ?? '0');
    const totalPaidInvoices = formatCurrency(
      data[2]
        .filter((e) => e.status === 'paid')
        .reduce((sum, current) => sum + current.amount, 0) ?? '0',
    );
    const totalPendingInvoices = formatCurrency(
      data[2]
        .filter((e) => e.status === 'pending')
        .reduce((sum, current) => sum + current.amount, 0) ?? '0',
    );

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch card data.');
  }
}

async function fetchFilteredInvoicesUnpaginated(query: string) {
  noStore();

  try {
    // const invoices = await sql<InvoicesTable>`
    //   SELECT
    //     invoices.id,
    //     invoices.amount,
    //     invoices.date,
    //     invoices.status,
    //     customers.name,
    //     customers.email,
    //     customers.image_url
    //   FROM invoices
    //   JOIN customers ON invoices.customer_id = customers.id
    //   WHERE
    //     customers.name ILIKE ${`%${query}%`} OR
    //     customers.email ILIKE ${`%${query}%`} OR
    //     invoices.amount::text ILIKE ${`%${query}%`} OR
    //     invoices.date::text ILIKE ${`%${query}%`} OR
    //     invoices.status ILIKE ${`%${query}%`}
    //   ORDER BY invoices.date DESC
    //   LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    // `;

    const invoices: Invoice[] = await fetchInvoices();
    const customers: Customer[] = await fetchCustomers();

    const allInvoicesTable: InvoicesTable[] = invoices.map((invoice, i) => {
      const customer = customers.find((e) => e.id === invoice.customer_id)!;

      return {
        id: `${i}`,
        customer_id: customer.id,
        amount: invoice.amount,
        date: invoice.date,
        email: customer.email,
        image_url: customer.image_url,
        name: customer.name,
        status: invoice.status,
      };
    });

    const filteredInvoicesTable = allInvoicesTable.filter((ele) => {
      return (
        ele.name.indexOf(query) >= 0 ||
        ele.email.indexOf(query) >= 0 ||
        ele.amount.toString().indexOf(query) >= 0 ||
        ele.date.toString().indexOf(query) >= 0 ||
        ele.status.toString().indexOf(query) >= 0
      );
    });
    return filteredInvoicesTable;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

const ITEMS_PER_PAGE = 6;
export async function fetchFilteredInvoices(
  query: string,
  currentPage: number,
) {
  try {
    const offset = (currentPage - 1) * ITEMS_PER_PAGE;
    const filteredInvoicesTable = await fetchFilteredInvoicesUnpaginated(query);

    return filteredInvoicesTable.slice(offset, offset + ITEMS_PER_PAGE);
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoices.');
  }
}

function sortByDateDescending(
  a: InvoicesTable | Invoice,
  b: InvoicesTable | Invoice,
): number {
  return a.date > b.date ? -1 : 1;
}

export async function fetchInvoicesPages(query: string) {
  noStore();
  try {
    const invoices = await fetchFilteredInvoicesUnpaginated(query);

    const totalPages = Math.ceil(Number(invoices.length) / ITEMS_PER_PAGE);
    return totalPages;
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

export async function fetchInvoiceById(id: string) {
  noStore();
  try {
    const invoice = (await fetchInvoices()).map((invoice, index) => ({
      ...invoice,
      // Convert amount from cents to dollars
      amount: invoice.amount / 100,
    }));

    return invoice[+id];
  } catch (error) {
    console.error('Database Error:', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  noStore();
  try {
    const data = await sql<CustomersTableType>`
		SELECT
		  customers.id,
		  customers.name,
		  customers.email,
		  customers.image_url,
		  COUNT(invoices.id) AS total_invoices,
		  SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
		  SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
		FROM customers
		LEFT JOIN invoices ON customers.id = invoices.customer_id
		WHERE
		  customers.name ILIKE ${`%${query}%`} OR
        customers.email ILIKE ${`%${query}%`}
		GROUP BY customers.id, customers.name, customers.email, customers.image_url
		ORDER BY customers.name ASC
	  `;

    const customers = data.rows.map((customer) => ({
      ...customer,
      total_pending: formatCurrency(customer.total_pending),
      total_paid: formatCurrency(customer.total_paid),
    }));

    return customers;
  } catch (err) {
    console.error('Database Error:', err);
    throw new Error('Failed to fetch customer table.');
  }
}

export async function getUser(email: string) {
  try {
    const user = await sql`SELECT * FROM users WHERE email=${email}`;
    return user.rows[0] as User;
  } catch (error) {
    console.error('Failed to fetch user:', error);
    throw new Error('Failed to fetch user.');
  }
}
