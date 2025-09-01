import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
// Import your components/pages
import { Loader } from 'lucide-react';
import { Suspense } from 'react';
import { cn } from './lib/utils';
import Home from './pages/Home';
import { AnimatePresence } from 'framer-motion';
import { BASE_PATH } from './lib/config';
import ImagePlus from './pages/ImagePlus';
// import TablePlusWithoutPagination from './pages/TablePlusWithoutPagination';
import TablePlusWithPagination from './pages/TablePlusWithPagination';
function App() {
  return (
    <><Suspense fallback={<LoadingSpinner />}>
      <Router basename={BASE_PATH}>
          <AnimatePresence mode="wait">
            <Routes >
              <Route path='*' element={<Home />} />
              <Route path='image-plus' element={<ImagePlus />} />
              <Route path='table-plus-with-pagination' element={<TablePlusWithPagination />} />
            </Routes>
          </AnimatePresence>
        </Router>
    </Suspense></>
  );
}

export const LoadingSpinner = ({ className }: { className?: string }) => {
  return <div className="flex justify-center items-center w-full h-screen">
      <Loader className={cn("animate-spin w-15 h-15", className)} />
    </div>;
};

export default App;
