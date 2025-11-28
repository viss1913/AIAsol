import React, { useState, useEffect } from 'react';
import axios from 'axios';

interface Contexts {
    baseBrainContext: string;
    contexts: Record<string, { classifier: string; response: string }>;
}

// Sub-component for auto-saving textareas
const AutoSaveTextarea: React.FC<{
    value: string;
    onSave: (newValue: string) => void;
    height?: string;
}> = ({ value, onSave, height = '100px' }) => {
    const [localValue, setLocalValue] = useState(value);

    // Update local state if prop changes (e.g. from server fetch)
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleBlur = () => {
        if (localValue !== value) {
            onSave(localValue);
        }
    };

    return (
        <textarea
            style={{ width: '100%', height, padding: '10px' }}
            value={localValue}
            onChange={(e) => setLocalValue(e.target.value)}
            onBlur={handleBlur}
        />
    );
};

const AdminContext: React.FC = () => {
    const [data, setData] = useState<Contexts | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [newCommand, setNewCommand] = useState('');

    useEffect(() => {
        fetchContexts();
    }, []);

    const fetchContexts = async () => {
        try {
            const response = await axios.get('/api/admin/context');
            setData(response.data);
            setLoading(false);
        } catch (err) {
            setError('Failed to load contexts');
            setLoading(false);
        }
    };

    const handleUpdate = async (key: string, value: string, type?: 'classifier' | 'response') => {
        try {
            await axios.post('/api/admin/context', { key, value, type });
            // Refetch to ensure we have the latest server state
            await fetchContexts();
            // Optional: Toast notification instead of alert
            console.log('Updated successfully');
        } catch (err) {
            alert('Failed to update');
        }
    };

    const handleAddCommand = async () => {
        if (!newCommand.startsWith('/')) {
            alert('Command must start with /');
            return;
        }
        await handleUpdate(newCommand, '', 'classifier');
        setNewCommand('');
    };

    const handleDelete = async (key: string) => {
        if (!confirm(`Are you sure you want to delete command ${key}?`)) return;
        try {
            await axios.post('/api/admin/context/delete', { key });
            await fetchContexts();
        } catch (err) {
            console.error(err);
            alert('Failed to delete');
        }
    };

    if (loading) return <div>Loading...</div>;
    if (error) return <div>{error}</div>;
    if (!data) return <div>No data</div>;

    return (
        <div style={{ padding: '20px', maxWidth: '800px', margin: '0 auto' }}>
            <h1>AI Context Management</h1>

            <section style={{ marginBottom: '40px' }}>
                <h2>Base Brain Context (Global)</h2>
                <AutoSaveTextarea
                    height="200px"
                    value={data.baseBrainContext}
                    onSave={(val) => handleUpdate('baseBrainContext', val)}
                />
                <p style={{ fontSize: '0.8em', color: '#666' }}>Click outside to save.</p>
            </section>

            <section>
                <h2>Command Contexts</h2>

                <div style={{ marginBottom: '20px' }}>
                    <input
                        type="text"
                        placeholder="/newCommand"
                        value={newCommand}
                        onChange={(e) => setNewCommand(e.target.value)}
                        style={{ padding: '5px', marginRight: '10px' }}
                    />
                    <button onClick={handleAddCommand}>Add Command</button>
                </div>

                {Object.entries(data.contexts).map(([command, context]) => (
                    <div key={command} style={{ border: '1px solid #ccc', padding: '15px', marginBottom: '20px', borderRadius: '5px' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>{command}</h3>
                            <button
                                onClick={() => handleDelete(command)}
                                style={{
                                    backgroundColor: '#ff4444',
                                    color: 'white',
                                    border: 'none',
                                    padding: '5px 10px',
                                    borderRadius: '4px',
                                    cursor: 'pointer'
                                }}
                            >
                                Delete
                            </button>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <h4>Classifier Context (Step 1)</h4>
                            <AutoSaveTextarea
                                value={context.classifier}
                                onSave={(val) => handleUpdate(command, val, 'classifier')}
                            />
                        </div>

                        <div>
                            <h4>Response Context (Step 2)</h4>
                            <AutoSaveTextarea
                                value={context.response}
                                onSave={(val) => handleUpdate(command, val, 'response')}
                            />
                        </div>
                    </div>
                ))}
            </section>
        </div>
    );
};

export default AdminContext;
